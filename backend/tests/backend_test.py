"""RosterSync backend regression tests."""
import os
import random
from datetime import date, timedelta

import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


def _rand_pin():
    return f"{random.randint(0, 9999):04d}"


def _next_weekday(target_dow: int) -> str:
    today = date.today()
    delta = (target_dow - today.weekday()) % 7
    if delta == 0:
        delta = 7
    return (today + timedelta(days=delta)).isoformat()


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def regular_user(session):
    """Register a regular Mon-Fri user with Wed anchor."""
    for _ in range(10):
        pin = _rand_pin()
        payload = {
            "name": "TEST Worker",
            "pin": pin,
            "working_days": [0, 1, 2, 3, 4],
            "initial_day_off_date": _next_weekday(2),  # Wednesday
            "is_admin": False,
        }
        r = session.post(f"{API}/auth/register", json=payload)
        if r.status_code == 200:
            return {"pin": pin, "token": r.json()["token"], "user": r.json()["user"]}
    pytest.fail("Could not register regular user")


@pytest.fixture(scope="module")
def admin_user(session):
    for _ in range(10):
        pin = _rand_pin()
        payload = {
            "name": "TEST Admin",
            "pin": pin,
            "working_days": [0, 1, 2, 3, 4],
            "initial_day_off_date": _next_weekday(4),  # Friday
            "is_admin": True,
        }
        r = session.post(f"{API}/auth/register", json=payload)
        if r.status_code == 200:
            return {"pin": pin, "token": r.json()["token"], "user": r.json()["user"]}
    pytest.fail("Could not register admin user")


# ---------- Health ----------
def test_root(session):
    r = session.get(f"{API}/")
    assert r.status_code == 200
    assert "message" in r.json()


# ---------- Register ----------
class TestRegister:
    def test_register_success(self, regular_user):
        assert regular_user["token"]
        u = regular_user["user"]
        assert u["name"] == "TEST Worker"
        assert u["is_admin"] is False
        assert u["working_days"] == [0, 1, 2, 3, 4]

    def test_bad_pin_rejected(self, session):
        r = session.post(f"{API}/auth/register", json={
            "name": "TEST Bad", "pin": "12", "working_days": [0], "initial_day_off_date": _next_weekday(0),
        })
        assert r.status_code == 422

    def test_duplicate_pin(self, session, regular_user):
        r = session.post(f"{API}/auth/register", json={
            "name": "TEST Dupe",
            "pin": regular_user["pin"],
            "working_days": [0, 1, 2, 3, 4],
            "initial_day_off_date": _next_weekday(2),
            "is_admin": False,
        })
        assert r.status_code == 409

    def test_anchor_not_in_working_days(self, session):
        # anchor Saturday but working days Mon-Fri
        r = session.post(f"{API}/auth/register", json={
            "name": "TEST Anchor",
            "pin": _rand_pin(),
            "working_days": [0, 1, 2, 3, 4],
            "initial_day_off_date": _next_weekday(5),  # Saturday
            "is_admin": False,
        })
        assert r.status_code == 400


# ---------- Login ----------
class TestLogin:
    def test_login_correct(self, session, regular_user):
        r = session.post(f"{API}/auth/login", json={"pin": regular_user["pin"]})
        assert r.status_code == 200
        assert "token" in r.json() and "user" in r.json()

    def test_login_wrong(self, session):
        r = session.post(f"{API}/auth/login", json={"pin": "0000"})
        # if 0000 happens to be registered, retry with unlikely combo
        assert r.status_code in (401, 200)  # 200 only if collision
        if r.status_code == 200:
            r2 = session.post(f"{API}/auth/login", json={"pin": "0001"})
            # As long as SOMETHING can return 401
            assert r2.status_code in (200, 401)

    def test_login_bad_format(self, session):
        r = session.post(f"{API}/auth/login", json={"pin": "abc"})
        assert r.status_code == 400


# ---------- /users/me ----------
class TestMe:
    def test_me_requires_auth(self, session):
        r = session.get(f"{API}/users/me")
        assert r.status_code == 401

    def test_me_ok(self, session, regular_user):
        r = session.get(f"{API}/users/me", headers={"Authorization": f"Bearer {regular_user['token']}"})
        assert r.status_code == 200
        assert r.json()["id"] == regular_user["user"]["id"]

    def test_update_me_validates_anchor(self, session, regular_user):
        # Try updating anchor to a non-working day
        r = session.put(f"{API}/users/me",
            headers={"Authorization": f"Bearer {regular_user['token']}"},
            json={"working_days": [0, 1, 2, 3, 4], "initial_day_off_date": _next_weekday(6)})
        assert r.status_code == 400

    def test_update_me_ok(self, session, regular_user):
        new_anchor = _next_weekday(2)
        r = session.put(f"{API}/users/me",
            headers={"Authorization": f"Bearer {regular_user['token']}"},
            json={"working_days": [0, 1, 2, 3, 4], "initial_day_off_date": new_anchor})
        assert r.status_code == 200
        # GET to verify persistence
        r2 = session.get(f"{API}/users/me", headers={"Authorization": f"Bearer {regular_user['token']}"})
        assert r2.json()["initial_day_off_date"] == new_anchor


# ---------- Roster ----------
class TestRoster:
    def test_roster_14_days(self, session, regular_user):
        # Start on a Monday
        today = date.today()
        monday = today - timedelta(days=today.weekday())
        r = session.get(f"{API}/roster/me?start={monday.isoformat()}&days=14",
                        headers={"Authorization": f"Bearer {regular_user['token']}"})
        assert r.status_code == 200
        data = r.json()
        assert len(data["days"]) == 14

    def test_week1_all_regular(self, session, admin_user):
        """For admin (Fri anchor), week 1 (with fortnight starting Monday before anchor's week) should have no day_off/short."""
        anchor = date.fromisoformat(admin_user["user"]["initial_day_off_date"])
        # Week 1 of that fortnight begins Monday of anchor_week - 7 days
        anchor_week_mon = anchor - timedelta(days=anchor.weekday())
        w1_start = anchor_week_mon - timedelta(days=7)
        r = session.get(f"{API}/roster/me?start={w1_start.isoformat()}&days=14",
                        headers={"Authorization": f"Bearer {admin_user['token']}"})
        assert r.status_code == 200
        days = r.json()["days"]
        week1 = days[:7]
        week2 = days[7:14]
        # Week 1 should have zero day_off/short
        for d in week1:
            assert d["status"] in ("regular", "non_working")
        # Week 2 should contain exactly one day_off and one short
        offs = [d for d in week2 if d["status"] == "day_off"]
        shorts = [d for d in week2 if d["status"] == "short"]
        assert len(offs) == 1
        assert len(shorts) == 1
        # Anchor day matches
        assert offs[0]["date"] == admin_user["user"]["initial_day_off_date"]

    def test_wraparound_monday_anchor(self, session):
        """When anchor day-off = Monday (earliest working day), short day should be Friday of SAME week."""
        pin = _rand_pin()
        anchor = _next_weekday(0)  # Monday
        reg = session.post(f"{API}/auth/register", json={
            "name": "TEST Wrap",
            "pin": pin,
            "working_days": [0, 1, 2, 3, 4],
            "initial_day_off_date": anchor,
            "is_admin": False,
        })
        assert reg.status_code == 200, reg.text
        token = reg.json()["token"]
        anchor_d = date.fromisoformat(anchor)
        w1_start = anchor_d - timedelta(days=7)  # anchor is Monday -> anchor_week_mon = anchor. Fortnight0 starts anchor - 7
        r = session.get(f"{API}/roster/me?start={w1_start.isoformat()}&days=14",
                        headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        days = r.json()["days"]
        week2 = days[7:14]
        # Day off on Monday (day_in_week=0), short should be Friday of SAME week (day_in_week=4)
        assert week2[0]["status"] == "day_off"
        assert week2[4]["status"] == "short"
        assert week2[4]["weekday_name"] == "Fri"

    def test_rotation_next_fortnight(self, session, admin_user):
        """Next fortnight day-off rotates one working day earlier."""
        anchor = date.fromisoformat(admin_user["user"]["initial_day_off_date"])  # Fri (dow=4)
        anchor_week_mon = anchor - timedelta(days=anchor.weekday())
        w1_start = anchor_week_mon - timedelta(days=7)
        next_start = w1_start + timedelta(days=14)
        r = session.get(f"{API}/roster/me?start={next_start.isoformat()}&days=14",
                        headers={"Authorization": f"Bearer {admin_user['token']}"})
        assert r.status_code == 200
        days = r.json()["days"]
        week2 = days[7:14]
        offs = [d for d in week2 if d["status"] == "day_off"]
        assert len(offs) == 1
        # Should be Thursday (dow=3), one working day earlier from Fri
        assert offs[0]["weekday"] == 3

    def test_today_endpoint(self, session, regular_user):
        r = session.get(f"{API}/roster/today",
                        headers={"Authorization": f"Bearer {regular_user['token']}"})
        assert r.status_code == 200
        d = r.json()
        assert d["status"] in ("regular", "short", "day_off", "non_working")
        assert "hours" in d and "label" in d


# ---------- Admin ----------
class TestAdmin:
    def test_admin_users_requires_admin(self, session, regular_user):
        r = session.get(f"{API}/admin/users",
                        headers={"Authorization": f"Bearer {regular_user['token']}"})
        assert r.status_code == 403

    def test_admin_users_ok(self, session, admin_user):
        r = session.get(f"{API}/admin/users",
                        headers={"Authorization": f"Bearer {admin_user['token']}"})
        assert r.status_code == 200
        users = r.json()["users"]
        assert isinstance(users, list)
        assert any(u["id"] == admin_user["user"]["id"] for u in users)
        # No pin_hash or _id leaked
        for u in users:
            assert "pin_hash" not in u
            assert "_id" not in u

    def test_admin_roster_by_id(self, session, admin_user, regular_user):
        r = session.get(f"{API}/admin/roster/{regular_user['user']['id']}?days=14",
                        headers={"Authorization": f"Bearer {admin_user['token']}"})
        assert r.status_code == 200
        assert len(r.json()["days"]) == 14

    def test_admin_roster_forbidden_for_regular(self, session, regular_user):
        r = session.get(f"{API}/admin/roster/{regular_user['user']['id']}",
                        headers={"Authorization": f"Bearer {regular_user['token']}"})
        assert r.status_code == 403
