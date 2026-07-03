from fastapi import FastAPI, APIRouter, HTTPException, Header, Depends
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import hashlib
import uuid
from pathlib import Path
from pydantic import BaseModel, Field, field_validator
from typing import List, Optional, Dict
from datetime import datetime, timedelta, date, timezone

from wa_holidays import (
    get_public_holiday,
    get_school_holiday,
    list_holidays_between,
    refresh_cache,
)

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

PIN_PEPPER = os.environ.get("PIN_PEPPER", "rostersync-v1-pepper")

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# ---------- Helpers ----------
def hash_pin(pin: str) -> str:
    return hashlib.sha256((PIN_PEPPER + pin).encode()).hexdigest()


def iso_date(d: date) -> str:
    return d.isoformat()


def parse_date(s: str) -> date:
    return datetime.strptime(s, "%Y-%m-%d").date()


# ---------- Models ----------
class UserPublic(BaseModel):
    id: str
    name: str
    working_days: List[int]  # 0=Mon .. 6=Sun
    initial_day_off_date: str  # YYYY-MM-DD
    is_admin: bool
    created_at: str


class RegisterRequest(BaseModel):
    name: str
    pin: str
    working_days: List[int]
    initial_day_off_date: str
    is_admin: bool = False

    @field_validator('pin')
    @classmethod
    def validate_pin(cls, v: str) -> str:
        if not (len(v) == 4 and v.isdigit()):
            raise ValueError("PIN must be exactly 4 digits")
        return v

    @field_validator('working_days')
    @classmethod
    def validate_wd(cls, v: List[int]) -> List[int]:
        if not v:
            raise ValueError("Select at least one working day")
        for d in v:
            if d < 0 or d > 6:
                raise ValueError("Working days must be 0-6")
        return sorted(set(v))

    @field_validator('name')
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 2:
            raise ValueError("Name too short")
        return v


class LoginRequest(BaseModel):
    pin: str


class UpdateRosterRequest(BaseModel):
    working_days: List[int]
    initial_day_off_date: str

    @field_validator('working_days')
    @classmethod
    def validate_wd(cls, v: List[int]) -> List[int]:
        if not v:
            raise ValueError("Select at least one working day")
        return sorted(set(v))


class AuthResponse(BaseModel):
    token: str
    user: UserPublic


class DayEntry(BaseModel):
    date: str  # YYYY-MM-DD
    weekday: int
    weekday_name: str
    status: str  # regular | short | day_off | non_working | leave
    hours: float
    label: str
    is_today: bool
    public_holiday: Optional[str] = None
    school_holiday: Optional[str] = None
    leave_note: Optional[str] = None


class Leave(BaseModel):
    id: str
    date: str
    note: Optional[str] = None
    created_at: str


class LeaveCreate(BaseModel):
    date: str
    note: Optional[str] = None

    @field_validator('date')
    @classmethod
    def valid_date(cls, v: str) -> str:
        datetime.strptime(v, "%Y-%m-%d")
        return v


class RosterResponse(BaseModel):
    start_date: str
    end_date: str
    days: List[DayEntry]


# ---------- Auth dependency ----------
async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing auth token")
    token = authorization.split(" ", 1)[1].strip()
    session = await db.sessions.find_one({"token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    user = await db.users.find_one({"id": session["user_id"]}, {"_id": 0, "pin_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin only")
    return user


# ---------- Roster computation ----------
WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def compute_day_status(user: dict, d: date):
    """Return (status, hours, label) for date d."""
    working_days = sorted(user["working_days"])
    anchor = parse_date(user["initial_day_off_date"])
    anchor_dow = anchor.weekday()

    if anchor_dow not in working_days:
        # Anchor day-off must be a working day. Fallback: treat as regular.
        return ("regular", 8.5, "8.5h paid")

    # fortnight0_start = Monday of week1 of the anchor's fortnight.
    # Anchor is in week 2 of that fortnight.
    anchor_week_monday = anchor - timedelta(days=anchor_dow)
    fortnight0_start = anchor_week_monday - timedelta(days=7)

    days_diff = (d - fortnight0_start).days
    fortnight_index = days_diff // 14  # floor division; negatives handled
    day_in_fortnight = days_diff % 14  # Python % always non-negative

    # Determine day-off weekday for this fortnight
    initial_idx = working_days.index(anchor_dow)
    n = len(working_days)
    shifted_idx = (initial_idx - fortnight_index) % n
    day_off_dow = working_days[shifted_idx]
    short_dow = working_days[(shifted_idx - 1) % n]

    d_dow = d.weekday()
    if d_dow not in working_days:
        return ("non_working", 0.0, WEEKDAY_NAMES[d_dow])

    is_week2 = day_in_fortnight >= 7

    if is_week2:
        if d_dow == day_off_dow:
            return ("day_off", 0.0, "Day off")
        if d_dow == short_dow:
            return ("short", 8.0, "Short 8h paid")
        return ("regular", 8.5, "8.5h paid")
    else:
        return ("regular", 8.5, "8.5h paid")


def build_roster(user: dict, start: date, num_days: int, leaves: Optional[Dict[str, str]] = None) -> RosterResponse:
    """leaves: {ISO date: note} — any date here becomes status='leave' with 0h."""
    today = datetime.now(timezone.utc).date()
    leaves = leaves or {}
    entries: List[DayEntry] = []
    for i in range(num_days):
        d = start + timedelta(days=i)
        iso = iso_date(d)
        if iso in leaves:
            status, hours, label = "leave", 0.0, "Personal leave"
            leave_note: Optional[str] = leaves[iso] or None
        else:
            status, hours, label = compute_day_status(user, d)
            leave_note = None
        entries.append(DayEntry(
            date=iso,
            weekday=d.weekday(),
            weekday_name=WEEKDAY_NAMES[d.weekday()],
            status=status,
            hours=hours,
            label=label,
            is_today=(d == today),
            public_holiday=get_public_holiday(d),
            school_holiday=get_school_holiday(d),
            leave_note=leave_note,
        ))
    return RosterResponse(
        start_date=iso_date(start),
        end_date=iso_date(start + timedelta(days=num_days - 1)),
        days=entries,
    )


async def get_user_leaves_map(user_id: str, start: date, end: date) -> Dict[str, str]:
    # Bounded by date range; a fortnight/quarter view can never realistically
    # exceed a few hundred leave rows per user. Cap defensively.
    docs = await db.leaves.find(
        {"user_id": user_id, "date": {"$gte": start.isoformat(), "$lte": end.isoformat()}},
        {"_id": 0},
    ).to_list(500)
    return {d["date"]: d.get("note", "") for d in docs}


# ---------- Routes ----------
@api_router.get("/")
async def root():
    return {"message": "RosterSync API"}


@api_router.post("/auth/register", response_model=AuthResponse)
async def register(payload: RegisterRequest):
    try:
        anchor = parse_date(payload.initial_day_off_date)
    except Exception:
        raise HTTPException(status_code=400, detail="initial_day_off_date must be YYYY-MM-DD")

    if anchor.weekday() not in payload.working_days:
        raise HTTPException(status_code=400, detail="Day-off must fall on one of your working days")

    pin_hash = hash_pin(payload.pin)
    if await db.users.find_one({"pin_hash": pin_hash}):
        raise HTTPException(status_code=409, detail="This PIN is already in use. Choose another 4-digit PIN.")

    user_doc = {
        "id": str(uuid.uuid4()),
        "name": payload.name,
        "pin_hash": pin_hash,
        "working_days": payload.working_days,
        "initial_day_off_date": payload.initial_day_off_date,
        "is_admin": payload.is_admin,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(user_doc)

    token = str(uuid.uuid4())
    await db.sessions.insert_one({
        "token": token,
        "user_id": user_doc["id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    user_doc.pop("pin_hash", None)
    user_doc.pop("_id", None)
    return AuthResponse(token=token, user=UserPublic(**user_doc))


@api_router.post("/auth/login", response_model=AuthResponse)
async def login(payload: LoginRequest):
    if not (len(payload.pin) == 4 and payload.pin.isdigit()):
        raise HTTPException(status_code=400, detail="PIN must be 4 digits")
    pin_hash = hash_pin(payload.pin)
    user = await db.users.find_one({"pin_hash": pin_hash}, {"_id": 0, "pin_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="No user found for this PIN")

    token = str(uuid.uuid4())
    await db.sessions.insert_one({
        "token": token,
        "user_id": user["id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return AuthResponse(token=token, user=UserPublic(**user))


@api_router.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
        await db.sessions.delete_one({"token": token})
    return {"ok": True}


@api_router.get("/users/me", response_model=UserPublic)
async def me(user: dict = Depends(get_current_user)):
    return UserPublic(**user)


@api_router.put("/users/me", response_model=UserPublic)
async def update_me(payload: UpdateRosterRequest, user: dict = Depends(get_current_user)):
    try:
        anchor = parse_date(payload.initial_day_off_date)
    except Exception:
        raise HTTPException(status_code=400, detail="initial_day_off_date must be YYYY-MM-DD")

    for d in payload.working_days:
        if d < 0 or d > 6:
            raise HTTPException(status_code=400, detail="Working days must be 0-6")

    if anchor.weekday() not in payload.working_days:
        raise HTTPException(status_code=400, detail="Day-off must fall on one of your working days")

    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {
            "working_days": sorted(set(payload.working_days)),
            "initial_day_off_date": payload.initial_day_off_date,
        }},
    )
    updated = await db.users.find_one({"id": user["id"]}, {"_id": 0, "pin_hash": 0})
    return UserPublic(**updated)


@api_router.get("/roster/me", response_model=RosterResponse)
async def my_roster(start: Optional[str] = None, days: int = 14, user: dict = Depends(get_current_user)):
    if days < 1 or days > 180:
        raise HTTPException(status_code=400, detail="days must be 1..180")
    if start:
        try:
            start_date = parse_date(start)
        except Exception:
            raise HTTPException(status_code=400, detail="start must be YYYY-MM-DD")
    else:
        today = datetime.now(timezone.utc).date()
        start_date = today - timedelta(days=today.weekday())  # Monday of current week
    end_date = start_date + timedelta(days=days - 1)
    leaves = await get_user_leaves_map(user["id"], start_date, end_date)
    return build_roster(user, start_date, days, leaves)


@api_router.get("/roster/today")
async def roster_today(user: dict = Depends(get_current_user)):
    today = datetime.now(timezone.utc).date()
    leaves = await get_user_leaves_map(user["id"], today, today)
    iso = today.isoformat()
    if iso in leaves:
        status, hours, label = "leave", 0.0, "Personal leave"
        leave_note = leaves[iso] or None
    else:
        status, hours, label = compute_day_status(user, today)
        leave_note = None
    return {
        "date": iso,
        "weekday_name": WEEKDAY_NAMES[today.weekday()],
        "status": status,
        "hours": hours,
        "label": label,
        "public_holiday": get_public_holiday(today),
        "school_holiday": get_school_holiday(today),
        "leave_note": leave_note,
    }


@api_router.get("/holidays")
async def get_holidays(start: Optional[str] = None, end: Optional[str] = None):
    today = datetime.now(timezone.utc).date()
    s = parse_date(start) if start else date(today.year, 1, 1)
    e = parse_date(end) if end else date(today.year + 1, 12, 31)
    return {"holidays": list_holidays_between(s, e)}


# ---------- Personal leave ----------
@api_router.get("/leaves")
async def list_leaves(limit: int = 100, skip: int = 0, user: dict = Depends(get_current_user)):
    if limit < 1 or limit > 500:
        raise HTTPException(status_code=400, detail="limit must be 1..500")
    if skip < 0:
        raise HTTPException(status_code=400, detail="skip must be >= 0")
    cursor = (
        db.leaves.find({"user_id": user["id"]}, {"_id": 0, "user_id": 0})
        .sort("date", 1)
        .skip(skip)
        .limit(limit)
    )
    docs = await cursor.to_list(limit)
    total = await db.leaves.count_documents({"user_id": user["id"]})
    return {"leaves": docs, "total": total, "limit": limit, "skip": skip}


@api_router.post("/leaves", response_model=Leave)
async def add_leave(payload: LeaveCreate, user: dict = Depends(get_current_user)):
    # Enforce uniqueness per user+date
    existing = await db.leaves.find_one({"user_id": user["id"], "date": payload.date})
    if existing:
        raise HTTPException(status_code=409, detail="Leave already exists for this date")
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "date": payload.date,
        "note": (payload.note or "").strip(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.leaves.insert_one(doc)
    return Leave(id=doc["id"], date=doc["date"], note=doc["note"] or None, created_at=doc["created_at"])


@api_router.delete("/leaves/{leave_id}")
async def delete_leave(leave_id: str, user: dict = Depends(get_current_user)):
    res = await db.leaves.delete_one({"id": leave_id, "user_id": user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Leave not found")
    return {"ok": True}


# ---------- Admin ----------
@api_router.get("/admin/users")
async def admin_list_users(limit: int = 100, skip: int = 0, _: dict = Depends(require_admin)):
    if limit < 1 or limit > 500:
        raise HTTPException(status_code=400, detail="limit must be 1..500")
    if skip < 0:
        raise HTTPException(status_code=400, detail="skip must be >= 0")
    cursor = (
        db.users.find({}, {"_id": 0, "pin_hash": 0})
        .sort("created_at", 1)
        .skip(skip)
        .limit(limit)
    )
    users = await cursor.to_list(limit)
    total = await db.users.count_documents({})
    return {"users": users, "total": total, "limit": limit, "skip": skip}


@api_router.get("/admin/roster/{user_id}", response_model=RosterResponse)
async def admin_user_roster(user_id: str, start: Optional[str] = None, days: int = 14, _: dict = Depends(require_admin)):
    if days < 1 or days > 180:
        raise HTTPException(status_code=400, detail="days must be 1..180")
    target = await db.users.find_one({"id": user_id}, {"_id": 0, "pin_hash": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if start:
        start_date = parse_date(start)
    else:
        today = datetime.now(timezone.utc).date()
        start_date = today - timedelta(days=today.weekday())
    end_date = start_date + timedelta(days=days - 1)
    leaves = await get_user_leaves_map(target["id"], start_date, end_date)
    return build_roster(target, start_date, days, leaves)


@api_router.post("/admin/holidays/refresh")
async def admin_refresh_holidays(_: dict = Depends(require_admin)):
    """Refresh WA public holiday cache. Uses python-holidays library which
    computes holidays algorithmically for any year, so no external network
    fetch is required. Returns holidays computed per year."""
    result = refresh_cache()
    return {"refreshed": result}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_indexes():
    await db.users.create_index("pin_hash", unique=True)
    await db.users.create_index("id", unique=True)
    await db.sessions.create_index("token", unique=True)
    await db.leaves.create_index([("user_id", 1), ("date", 1)], unique=True)
    await db.leaves.create_index("id", unique=True)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
