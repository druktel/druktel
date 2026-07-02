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
from typing import List, Optional
from datetime import datetime, timedelta, date, timezone

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

PIN_PEPPER = "rostersync-v1-pepper"

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
    status: str  # regular | short | day_off | non_working
    hours: float
    label: str
    is_today: bool


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
        return ("regular", 9.0, "9h shift")

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
            return ("short", 8.5, "Short 8.5h")
        return ("regular", 9.0, "9h shift")
    else:
        return ("regular", 9.0, "9h shift")


def build_roster(user: dict, start: date, num_days: int) -> RosterResponse:
    today = datetime.now(timezone.utc).date()
    entries: List[DayEntry] = []
    for i in range(num_days):
        d = start + timedelta(days=i)
        status, hours, label = compute_day_status(user, d)
        entries.append(DayEntry(
            date=iso_date(d),
            weekday=d.weekday(),
            weekday_name=WEEKDAY_NAMES[d.weekday()],
            status=status,
            hours=hours,
            label=label,
            is_today=(d == today),
        ))
    return RosterResponse(
        start_date=iso_date(start),
        end_date=iso_date(start + timedelta(days=num_days - 1)),
        days=entries,
    )


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
    if days < 1 or days > 84:
        raise HTTPException(status_code=400, detail="days must be 1..84")
    if start:
        try:
            start_date = parse_date(start)
        except Exception:
            raise HTTPException(status_code=400, detail="start must be YYYY-MM-DD")
    else:
        today = datetime.now(timezone.utc).date()
        start_date = today - timedelta(days=today.weekday())  # Monday of current week
    return build_roster(user, start_date, days)


@api_router.get("/roster/today")
async def roster_today(user: dict = Depends(get_current_user)):
    today = datetime.now(timezone.utc).date()
    status, hours, label = compute_day_status(user, today)
    return {
        "date": iso_date(today),
        "weekday_name": WEEKDAY_NAMES[today.weekday()],
        "status": status,
        "hours": hours,
        "label": label,
    }


# ---------- Admin ----------
@api_router.get("/admin/users")
async def admin_list_users(_: dict = Depends(require_admin)):
    users = await db.users.find({}, {"_id": 0, "pin_hash": 0}).to_list(1000)
    return {"users": users}


@api_router.get("/admin/roster/{user_id}", response_model=RosterResponse)
async def admin_user_roster(user_id: str, start: Optional[str] = None, days: int = 14, _: dict = Depends(require_admin)):
    if days < 1 or days > 84:
        raise HTTPException(status_code=400, detail="days must be 1..84")
    target = await db.users.find_one({"id": user_id}, {"_id": 0, "pin_hash": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if start:
        start_date = parse_date(start)
    else:
        today = datetime.now(timezone.utc).date()
        start_date = today - timedelta(days=today.weekday())
    return build_roster(target, start_date, days)


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


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
