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
EMPLOYMENT_TYPES = {"FT", "PT"}
FT_SCHEDULES = {"fortnight_9", "daily_9_5", "daily_8"}


class UserPublic(BaseModel):
    id: str
    name: str
    working_days: List[int]  # 0=Mon .. 6=Sun
    initial_day_off_date: Optional[str] = None  # YYYY-MM-DD, only for FT/fortnight_9
    is_admin: bool
    created_at: str
    employment_type: str = "FT"  # "FT" | "PT"
    ft_schedule: Optional[str] = None  # "fortnight_9" | "daily_9_5" | "daily_8"
    pt_day_hours: Optional[Dict[str, float]] = None  # PT: keys are "0".."6" -> hours
    has_lunch_break: bool = True


class RegisterRequest(BaseModel):
    name: str
    pin: str
    working_days: List[int]
    initial_day_off_date: Optional[str] = None
    is_admin: bool = False
    employment_type: str = "FT"
    ft_schedule: Optional[str] = None
    pt_day_hours: Optional[Dict[str, float]] = None
    has_lunch_break: bool = True

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

    @field_validator('employment_type')
    @classmethod
    def validate_et(cls, v: str) -> str:
        if v not in EMPLOYMENT_TYPES:
            raise ValueError("employment_type must be FT or PT")
        return v


class LoginRequest(BaseModel):
    pin: str


class UpdateRosterRequest(BaseModel):
    working_days: List[int]
    initial_day_off_date: Optional[str] = None
    employment_type: str = "FT"
    ft_schedule: Optional[str] = None
    pt_day_hours: Optional[Dict[str, float]] = None
    has_lunch_break: bool = True

    @field_validator('working_days')
    @classmethod
    def validate_wd(cls, v: List[int]) -> List[int]:
        if not v:
            raise ValueError("Select at least one working day")
        return sorted(set(v))

    @field_validator('employment_type')
    @classmethod
    def validate_et(cls, v: str) -> str:
        if v not in EMPLOYMENT_TYPES:
            raise ValueError("employment_type must be FT or PT")
        return v


# Required number of working days per FT schedule (user requirement).
FT_REQUIRED_DAYS: Dict[str, int] = {
    "fortnight_9": 5,
    "daily_8": 5,
    "daily_9_5": 4,
}


def validate_schedule_payload(
    employment_type: str,
    ft_schedule: Optional[str],
    working_days: List[int],
    initial_day_off_date: Optional[str],
    pt_day_hours: Optional[Dict[str, float]],
) -> Dict[str, object]:
    """Cross-field validation for employment / schedule fields.
    Returns the normalized subset to persist."""
    if employment_type == "PT":
        if not pt_day_hours or not isinstance(pt_day_hours, dict):
            raise HTTPException(status_code=400, detail="Part-time needs hours for each working day")
        cleaned: Dict[str, float] = {}
        for dow in working_days:
            key = str(dow)
            if key not in pt_day_hours:
                raise HTTPException(status_code=400, detail=f"Missing hours for {WEEKDAY_NAMES[dow]}")
            try:
                hrs = float(pt_day_hours[key])
            except Exception:
                raise HTTPException(status_code=400, detail=f"Hours for {WEEKDAY_NAMES[dow]} must be a number")
            if hrs <= 0 or hrs > 14:
                raise HTTPException(status_code=400, detail=f"Hours for {WEEKDAY_NAMES[dow]} must be between 0 and 14")
            cleaned[key] = round(hrs, 2)
        return {
            "employment_type": "PT",
            "ft_schedule": None,
            "working_days": sorted(set(working_days)),
            "initial_day_off_date": None,
            "pt_day_hours": cleaned,
        }

    # Full-time
    if ft_schedule not in FT_SCHEDULES:
        raise HTTPException(status_code=400, detail="ft_schedule must be one of fortnight_9, daily_9_5, daily_8")

    required = FT_REQUIRED_DAYS.get(ft_schedule)
    unique_days = sorted(set(working_days))
    if required is not None and len(unique_days) != required:
        label = "9-day fortnight" if ft_schedule == "fortnight_9" else ("9.5h per day" if ft_schedule == "daily_9_5" else "8h per day")
        raise HTTPException(
            status_code=400,
            detail=f"{label} requires exactly {required} working days a week",
        )

    if ft_schedule == "fortnight_9":
        if not initial_day_off_date:
            raise HTTPException(status_code=400, detail="9-day fortnight requires an anchor day-off date")
        try:
            anchor = parse_date(initial_day_off_date)
        except Exception:
            raise HTTPException(status_code=400, detail="initial_day_off_date must be YYYY-MM-DD")
        if anchor.weekday() not in working_days:
            raise HTTPException(status_code=400, detail="Day-off must fall on one of your working days")
        return {
            "employment_type": "FT",
            "ft_schedule": "fortnight_9",
            "working_days": sorted(set(working_days)),
            "initial_day_off_date": initial_day_off_date,
            "pt_day_hours": None,
        }

    # daily_9_5 or daily_8
    return {
        "employment_type": "FT",
        "ft_schedule": ft_schedule,
        "working_days": sorted(set(working_days)),
        "initial_day_off_date": None,
        "pt_day_hours": None,
    }


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


class AccessCode(BaseModel):
    id: str
    code: str
    note: Optional[str] = None
    is_active: bool
    created_at: str


class AccessCodeCreate(BaseModel):
    code: str
    note: Optional[str] = None

    @field_validator('code')
    @classmethod
    def validate_code(cls, v: str) -> str:
        v = v.strip()
        if not (len(v) == 4 and v.isdigit()):
            raise ValueError("Access code must be exactly 4 digits")
        return v


class AccessVerifyRequest(BaseModel):
    code: str


class FriendPublic(BaseModel):
    id: str
    name: str
    working_days: List[int]
    since: str
    employment_type: str = "FT"


class DiscoverEntry(BaseModel):
    id: str
    name: str
    working_days: List[int]
    is_friend: bool
    employment_type: str = "FT"


class FeedItem(BaseModel):
    date: str
    type: str  # "day_off" | "leave" | "short"
    label: str
    friend_id: str
    friend_name: str
    friend_employment_type: str = "FT"
    note: Optional[str] = None


class Post(BaseModel):
    id: str
    user_id: str
    author_name: str
    text: str
    visibility: str  # "public" | "friends"
    created_at: str
    like_count: int = 0
    liked_by_me: bool = False
    reply_count: int = 0
    author_employment_type: str = "FT"


class PostCreate(BaseModel):
    text: str
    visibility: str = "public"

    @field_validator('text')
    @classmethod
    def validate_text(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Post cannot be empty")
        if len(v) > 500:
            raise ValueError("Post is too long (max 500 chars)")
        return v

    @field_validator('visibility')
    @classmethod
    def validate_visibility(cls, v: str) -> str:
        if v not in ("public", "friends"):
            raise ValueError("visibility must be 'public' or 'friends'")
        return v


class Reply(BaseModel):
    id: str
    post_id: str
    user_id: str
    author_name: str
    text: str
    created_at: str


class ReplyCreate(BaseModel):
    text: str

    @field_validator('text')
    @classmethod
    def validate_text(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Reply cannot be empty")
        if len(v) > 300:
            raise ValueError("Reply too long (max 300 chars)")
        return v


class Notification(BaseModel):
    id: str
    user_id: str  # recipient
    type: str  # "friend_post" | "reply"
    actor_id: str
    actor_name: str
    actor_employment_type: str = "FT"
    post_id: Optional[str] = None
    text: Optional[str] = None
    read: bool = False
    created_at: str


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
    """Return (status, hours, label) for date d based on user's employment type/schedule."""
    et = user.get("employment_type", "FT")
    schedule = user.get("ft_schedule", "fortnight_9")
    working_days = sorted(user.get("working_days", []))
    lunch = bool(user.get("has_lunch_break", True))
    d_dow = d.weekday()

    # ----- Part-time -----
    if et == "PT":
        if d_dow not in working_days:
            return ("non_working", 0.0, WEEKDAY_NAMES[d_dow])
        pt_map = user.get("pt_day_hours") or {}
        try:
            raw = float(pt_map.get(str(d_dow), 0.0) or 0.0)
        except Exception:
            raw = 0.0
        # For PT: entered hours are already the PAID hours. The lunch
        # checkbox is informational only (do not deduct) — user's rule.
        paid = max(0.0, raw)
        return ("regular", round(paid, 2), f"{paid:.1f}h paid")

    # ----- Full-time flat-daily schedules -----
    if schedule == "daily_9_5":
        if d_dow not in working_days:
            return ("non_working", 0.0, WEEKDAY_NAMES[d_dow])
        paid = 9.5 if lunch else 10.0
        return ("regular", paid, f"{paid:.1f}h paid")

    if schedule == "daily_8":
        if d_dow not in working_days:
            return ("non_working", 0.0, WEEKDAY_NAMES[d_dow])
        paid = 8.0 if lunch else 8.5
        return ("regular", paid, f"{paid:.1f}h paid")

    # ----- Full-time 9-day fortnight (existing logic) -----
    anchor_str = user.get("initial_day_off_date")
    if not anchor_str:
        if d_dow not in working_days:
            return ("non_working", 0.0, WEEKDAY_NAMES[d_dow])
        return ("regular", 8.5, "8.5h paid")
    anchor = parse_date(anchor_str)
    anchor_dow = anchor.weekday()

    if anchor_dow not in working_days:
        if d_dow not in working_days:
            return ("non_working", 0.0, WEEKDAY_NAMES[d_dow])
        return ("regular", 8.5, "8.5h paid")

    anchor_week_monday = anchor - timedelta(days=anchor_dow)
    fortnight0_start = anchor_week_monday - timedelta(days=7)

    days_diff = (d - fortnight0_start).days
    fortnight_index = days_diff // 14
    day_in_fortnight = days_diff % 14

    initial_idx = working_days.index(anchor_dow)
    n = len(working_days)
    shifted_idx = (initial_idx - fortnight_index) % n
    day_off_dow = working_days[shifted_idx]
    short_dow = working_days[(shifted_idx - 1) % n]

    if d_dow not in working_days:
        return ("non_working", 0.0, WEEKDAY_NAMES[d_dow])

    is_week2 = day_in_fortnight >= 7
    if is_week2:
        if d_dow == day_off_dow:
            return ("day_off", 0.0, "Day off")
        if d_dow == short_dow:
            return ("short", 8.0, "Short 8h paid")
        return ("regular", 8.5, "8.5h paid")
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
    return {"message": "Profile API"}


# ---------- Access gate (admin-managed codes) ----------
@api_router.post("/access/verify")
async def verify_access_code(payload: AccessVerifyRequest):
    code = payload.code.strip()
    if not (len(code) == 4 and code.isdigit()):
        raise HTTPException(status_code=400, detail="Code must be 4 digits")
    doc = await db.access_codes.find_one({"code": code, "is_active": True}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=401, detail="Invalid access code")
    return {
        "ok": True,
        "code_id": doc["id"],
        "is_admin_gate": bool(doc.get("is_admin_gate", False)),
    }


@api_router.post("/auth/register", response_model=AuthResponse)
async def register(payload: RegisterRequest):
    normalized = validate_schedule_payload(
        payload.employment_type,
        payload.ft_schedule,
        payload.working_days,
        payload.initial_day_off_date,
        payload.pt_day_hours,
    )

    pin_hash = hash_pin(payload.pin)
    if await db.users.find_one({"pin_hash": pin_hash}):
        raise HTTPException(status_code=409, detail="This PIN is already in use. Choose another 4-digit PIN.")

    user_doc = {
        "id": str(uuid.uuid4()),
        "name": payload.name,
        "pin_hash": pin_hash,
        # is_admin is NEVER settable via public registration — new users are
        # regular employees. Admins are pre-seeded or promoted server-side.
        "is_admin": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "has_lunch_break": bool(payload.has_lunch_break),
        **normalized,
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
    normalized = validate_schedule_payload(
        payload.employment_type,
        payload.ft_schedule,
        payload.working_days,
        payload.initial_day_off_date,
        payload.pt_day_hours,
    )
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {**normalized, "has_lunch_break": bool(payload.has_lunch_break)}},
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


# ---------- Friends & feed ----------
@api_router.get("/discover")
async def discover_users(limit: int = 50, user: dict = Depends(get_current_user)):
    """Return other users the current user can befriend."""
    if limit < 1 or limit > 200:
        raise HTTPException(status_code=400, detail="limit must be 1..200")
    friend_edges = await db.friends.find({"user_id": user["id"]}, {"_id": 0}).to_list(500)
    friend_ids = {e["friend_id"] for e in friend_edges}
    others = await db.users.find(
        {"id": {"$ne": user["id"]}},
        {"_id": 0, "pin_hash": 0},
    ).sort("created_at", -1).limit(limit).to_list(limit)
    entries = [
        DiscoverEntry(
            id=u["id"],
            name=u["name"],
            working_days=u.get("working_days", []),
            is_friend=(u["id"] in friend_ids),
            employment_type=u.get("employment_type", "FT"),
        )
        for u in others
    ]
    return {"users": entries}


@api_router.get("/friends")
async def list_friends(user: dict = Depends(get_current_user)):
    edges = await db.friends.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    friend_ids = [e["friend_id"] for e in edges]
    since_by_id = {e["friend_id"]: e["created_at"] for e in edges}
    if not friend_ids:
        return {"friends": []}
    friend_docs = await db.users.find(
        {"id": {"$in": friend_ids}}, {"_id": 0, "pin_hash": 0}
    ).to_list(500)
    friends = [
        FriendPublic(
            id=f["id"],
            name=f["name"],
            working_days=f.get("working_days", []),
            since=since_by_id.get(f["id"], ""),
            employment_type=f.get("employment_type", "FT"),
        )
        for f in friend_docs
    ]
    return {"friends": friends}


@api_router.post("/friends/{friend_id}")
async def add_friend(friend_id: str, user: dict = Depends(get_current_user)):
    if friend_id == user["id"]:
        raise HTTPException(status_code=400, detail="You cannot add yourself")
    target = await db.users.find_one({"id": friend_id}, {"_id": 0, "pin_hash": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    existing = await db.friends.find_one({"user_id": user["id"], "friend_id": friend_id})
    if existing:
        raise HTTPException(status_code=409, detail="Already in your friends list")
    now_iso = datetime.now(timezone.utc).isoformat()
    # Bidirectional friendship: create edges in both directions.
    await db.friends.insert_many([
        {"id": str(uuid.uuid4()), "user_id": user["id"], "friend_id": friend_id, "created_at": now_iso},
        {"id": str(uuid.uuid4()), "user_id": friend_id, "friend_id": user["id"], "created_at": now_iso},
    ])
    return {"ok": True, "friend": {"id": target["id"], "name": target["name"]}}


@api_router.delete("/friends/{friend_id}")
async def remove_friend(friend_id: str, user: dict = Depends(get_current_user)):
    res = await db.friends.delete_many({
        "$or": [
            {"user_id": user["id"], "friend_id": friend_id},
            {"user_id": friend_id, "friend_id": user["id"]},
        ]
    })
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Friendship not found")
    return {"ok": True}


@api_router.get("/feed")
async def friends_feed(days: int = 14, user: dict = Depends(get_current_user)):
    if days < 1 or days > 60:
        raise HTTPException(status_code=400, detail="days must be 1..60")
    edges = await db.friends.find({"user_id": user["id"]}, {"_id": 0}).to_list(500)
    friend_ids = [e["friend_id"] for e in edges]
    if not friend_ids:
        return {"items": []}

    friend_docs = await db.users.find(
        {"id": {"$in": friend_ids}}, {"_id": 0, "pin_hash": 0}
    ).to_list(500)

    today = datetime.now(timezone.utc).date()
    end = today + timedelta(days=days - 1)
    items: List[dict] = []
    for f in friend_docs:
        leaves_map = await get_user_leaves_map(f["id"], today, end)
        f_et = f.get("employment_type", "FT")
        for i in range(days):
            d = today + timedelta(days=i)
            iso = d.isoformat()
            if iso in leaves_map:
                items.append({
                    "date": iso,
                    "type": "leave",
                    "label": "Personal leave",
                    "friend_id": f["id"],
                    "friend_name": f["name"],
                    "friend_employment_type": f_et,
                    "note": leaves_map[iso] or None,
                })
                continue
            status, hours, label = compute_day_status(f, d)
            if status == "day_off":
                items.append({
                    "date": iso,
                    "type": "day_off",
                    "label": "Day off",
                    "friend_id": f["id"],
                    "friend_name": f["name"],
                    "friend_employment_type": f_et,
                    "note": None,
                })
            elif status == "short":
                items.append({
                    "date": iso,
                    "type": "short",
                    "label": "Short day (8h)",
                    "friend_id": f["id"],
                    "friend_name": f["name"],
                    "friend_employment_type": f_et,
                    "note": None,
                })
    items.sort(key=lambda x: (x["date"], x["friend_name"]))
    return {"items": items[:200]}


# ---------- Posts (short text updates) ----------
def _serialize_post(doc: dict, viewer_id: str) -> Post:
    liked_by = doc.get("liked_by") or []
    return Post(
        id=doc["id"],
        user_id=doc["user_id"],
        author_name=doc.get("author_name", ""),
        text=doc["text"],
        visibility=doc["visibility"],
        created_at=doc["created_at"],
        like_count=len(liked_by),
        liked_by_me=viewer_id in liked_by,
        reply_count=int(doc.get("reply_count", 0)),
        author_employment_type=doc.get("author_employment_type", "FT"),
    )


async def _notify_friends_of_post(author: dict, post_doc: dict) -> None:
    edges = await db.friends.find({"user_id": author["id"]}, {"_id": 0}).to_list(500)
    if not edges:
        return
    now = datetime.now(timezone.utc).isoformat()
    snippet = post_doc["text"][:80]
    actor_et = author.get("employment_type", "FT")
    notif_docs = [{
        "id": str(uuid.uuid4()),
        "user_id": edge["friend_id"],
        "type": "friend_post",
        "actor_id": author["id"],
        "actor_name": author["name"],
        "actor_employment_type": actor_et,
        "post_id": post_doc["id"],
        "text": snippet,
        "read": False,
        "created_at": now,
    } for edge in edges]
    if notif_docs:
        await db.notifications.insert_many(notif_docs)


@api_router.post("/posts", response_model=Post)
async def create_post(payload: PostCreate, user: dict = Depends(get_current_user)):
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "author_name": user["name"],
        "author_employment_type": user.get("employment_type", "FT"),
        "text": payload.text,
        "visibility": payload.visibility,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "liked_by": [],
        "reply_count": 0,
    }
    await db.posts.insert_one(doc)
    # Notify all friends that this user has posted (both visibilities apply
    # since friends can see both public + friends-only posts from friends).
    await _notify_friends_of_post(user, doc)
    doc.pop("_id", None)
    return _serialize_post(doc, user["id"])


@api_router.get("/posts")
async def list_posts(limit: int = 40, user: dict = Depends(get_current_user)):
    if limit < 1 or limit > 100:
        raise HTTPException(status_code=400, detail="limit must be 1..100")
    edges = await db.friends.find({"user_id": user["id"]}, {"_id": 0}).to_list(500)
    friend_ids = [e["friend_id"] for e in edges]
    friend_scope = friend_ids + [user["id"]]
    query = {
        "$or": [
            {"visibility": "public"},
            {"visibility": "friends", "user_id": {"$in": friend_scope}},
        ]
    }
    docs = await (
        db.posts.find(query, {"_id": 0})
        .sort("created_at", -1)
        .limit(limit)
        .to_list(limit)
    )
    return {"posts": [_serialize_post(d, user["id"]).model_dump() for d in docs]}


@api_router.delete("/posts/{post_id}")
async def delete_post(post_id: str, user: dict = Depends(get_current_user)):
    res = await db.posts.delete_one({"id": post_id, "user_id": user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Post not found")
    # Best-effort cleanup of replies + notifications tied to this post.
    await db.replies.delete_many({"post_id": post_id})
    await db.notifications.delete_many({"post_id": post_id})
    return {"ok": True}


@api_router.post("/posts/{post_id}/like")
async def toggle_like(post_id: str, user: dict = Depends(get_current_user)):
    post = await db.posts.find_one({"id": post_id}, {"_id": 0})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    liked_by = post.get("liked_by") or []
    if user["id"] in liked_by:
        await db.posts.update_one({"id": post_id}, {"$pull": {"liked_by": user["id"]}})
        liked = False
    else:
        await db.posts.update_one({"id": post_id}, {"$addToSet": {"liked_by": user["id"]}})
        liked = True
    fresh = await db.posts.find_one({"id": post_id}, {"_id": 0})
    return {
        "ok": True,
        "liked": liked,
        "like_count": len((fresh or {}).get("liked_by") or []),
    }


@api_router.get("/posts/{post_id}/replies")
async def list_replies(post_id: str, user: dict = Depends(get_current_user)):
    docs = await db.replies.find({"post_id": post_id}, {"_id": 0}).sort("created_at", 1).to_list(200)
    return {"replies": docs}


@api_router.post("/posts/{post_id}/replies", response_model=Reply)
async def create_reply(post_id: str, payload: ReplyCreate, user: dict = Depends(get_current_user)):
    post = await db.posts.find_one({"id": post_id}, {"_id": 0})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    doc = {
        "id": str(uuid.uuid4()),
        "post_id": post_id,
        "user_id": user["id"],
        "author_name": user["name"],
        "text": payload.text,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.replies.insert_one(doc)
    await db.posts.update_one({"id": post_id}, {"$inc": {"reply_count": 1}})
    # Notify post author (if not replying to yourself).
    if post["user_id"] != user["id"]:
        await db.notifications.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": post["user_id"],
            "type": "reply",
            "actor_id": user["id"],
            "actor_name": user["name"],
            "actor_employment_type": user.get("employment_type", "FT"),
            "post_id": post_id,
            "text": payload.text[:80],
            "read": False,
            "created_at": doc["created_at"],
        })
    doc.pop("_id", None)
    return Reply(**doc)


@api_router.delete("/posts/{post_id}/replies/{reply_id}")
async def delete_reply(post_id: str, reply_id: str, user: dict = Depends(get_current_user)):
    res = await db.replies.delete_one({"id": reply_id, "post_id": post_id, "user_id": user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Reply not found")
    await db.posts.update_one({"id": post_id}, {"$inc": {"reply_count": -1}})
    return {"ok": True}


# ---------- Notifications ----------
@api_router.get("/notifications")
async def list_notifications(limit: int = 30, user: dict = Depends(get_current_user)):
    if limit < 1 or limit > 100:
        raise HTTPException(status_code=400, detail="limit must be 1..100")
    docs = await (
        db.notifications.find({"user_id": user["id"]}, {"_id": 0})
        .sort("created_at", -1)
        .limit(limit)
        .to_list(limit)
    )
    unread = await db.notifications.count_documents({"user_id": user["id"], "read": False})
    return {"notifications": docs, "unread": unread}


@api_router.post("/notifications/mark-read")
async def mark_all_read(user: dict = Depends(get_current_user)):
    await db.notifications.update_many(
        {"user_id": user["id"], "read": False},
        {"$set": {"read": True}},
    )
    return {"ok": True}


@api_router.delete("/notifications/{notif_id}")
async def delete_notification(notif_id: str, user: dict = Depends(get_current_user)):
    res = await db.notifications.delete_one({"id": notif_id, "user_id": user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Notification not found")
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


# ---------- Admin: access codes ----------
@api_router.get("/admin/access-codes")
async def admin_list_access_codes(_: dict = Depends(require_admin)):
    docs = await db.access_codes.find({}, {"_id": 0}).sort("created_at", 1).to_list(500)
    return {"codes": docs}


@api_router.post("/admin/access-codes", response_model=AccessCode)
async def admin_create_access_code(payload: AccessCodeCreate, _: dict = Depends(require_admin)):
    existing = await db.access_codes.find_one({"code": payload.code})
    if existing:
        raise HTTPException(status_code=409, detail="This 4-digit code is already in use")
    doc = {
        "id": str(uuid.uuid4()),
        "code": payload.code,
        "note": (payload.note or "").strip(),
        "is_active": True,
        "is_admin_gate": bool(payload.is_admin_gate),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.access_codes.insert_one(doc)
    doc.pop("_id", None)
    return AccessCode(**doc)


@api_router.delete("/admin/access-codes/{code_id}")
async def admin_delete_access_code(code_id: str, _: dict = Depends(require_admin)):
    total = await db.access_codes.count_documents({"is_active": True})
    target = await db.access_codes.find_one({"id": code_id})
    if not target:
        raise HTTPException(status_code=404, detail="Access code not found")
    if target.get("is_active") and total <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete the last active access code")
    res = await db.access_codes.delete_one({"id": code_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Access code not found")
    return {"ok": True}


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
    await db.access_codes.create_index("code", unique=True)
    await db.access_codes.create_index("id", unique=True)
    await db.friends.create_index([("user_id", 1), ("friend_id", 1)], unique=True)
    await db.posts.create_index("created_at")
    await db.posts.create_index("user_id")
    await db.replies.create_index([("post_id", 1), ("created_at", 1)])
    await db.notifications.create_index([("user_id", 1), ("created_at", -1)])

    # Migration: backfill employment type on legacy users (pre-FT/PT feature).
    # Anyone without an employment_type gets treated as FT / 9-day fortnight,
    # which matches the original behaviour before this feature shipped.
    await db.users.update_many(
        {"employment_type": {"$exists": False}},
        {"$set": {
            "employment_type": "FT",
            "ft_schedule": "fortnight_9",
            "has_lunch_break": True,
        }},
    )

    # Seed the standard employee access code so new employees can pass the
    # gate. Admins can create additional codes via the Admin tab.
    if not await db.access_codes.find_one({"code": "0000"}):
        await db.access_codes.insert_one({
            "id": str(uuid.uuid4()),
            "code": "0000",
            "note": "Standard employee access code — share with new team members.",
            "is_active": True,
            "is_admin_gate": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    # Seed the ADMIN gate code. Anyone entering this at the gate is routed to
    # the admin-only sign-in flow (PIN 6641).
    if not await db.access_codes.find_one({"code": "0115"}):
        await db.access_codes.insert_one({
            "id": str(uuid.uuid4()),
            "code": "0115",
            "note": "Admin access — sign in with the admin PIN (6641).",
            "is_active": True,
            "is_admin_gate": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    # Seed the pre-provisioned admin user (PIN 6641) so the admin can log in
    # immediately after passing the 0115 admin gate.
    admin_pin_hash = hash_pin("6641")
    if not await db.users.find_one({"pin_hash": admin_pin_hash}):
        today = datetime.now(timezone.utc).date()
        # Pick the next upcoming Wednesday as the anchor day-off.
        offset = (2 - today.weekday()) % 7 or 7  # Wednesday = 2
        anchor = today + timedelta(days=offset)
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "name": "Administrator",
            "pin_hash": admin_pin_hash,
            "working_days": [0, 1, 2, 3, 4],
            "initial_day_off_date": anchor.isoformat(),
            "is_admin": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "employment_type": "FT",
            "ft_schedule": "fortnight_9",
            "has_lunch_break": True,
        })
        logger.info("Seeded admin user with PIN 6641.")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
