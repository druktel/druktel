"""Iteration 3: dynamic WA holidays (future years) + admin refresh + personal leave."""
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
def user_ctx(session):
    """Register a Mon-Fri worker with Wed anchor far in the future so we control leave dates."""
    for _ in range(10):
        pin = _rand_pin()
        payload = {
            "name": "TEST Leave User",
            "pin": pin,
            "working_days": [0, 1, 2, 3, 4],
            "initial_day_off_date": _next_weekday(2),  # Wednesday
            "is_admin": False,
            "employment_type": "FT",
            "ft_schedule": "fortnight_9",
            "has_lunch_break": True,
        }
        r = session.post(f"{API}/auth/register", json=payload)
        if r.status_code == 200:
            return {"pin": pin, "token": r.json()["token"], "user": r.json()["user"]}
    pytest.fail("Could not register user")


@pytest.fixture(scope="module")
def admin_ctx(session):
    # Public registration cannot create admins post-FT/PT. Use seeded Tempa R.
    r = session.post(f"{API}/auth/login", json={"pin": "6641"})
    if r.status_code != 200:
        pytest.fail(f"Could not log in as seeded admin (PIN 6641): {r.text}")
    body = r.json()
    return {"pin": "6641", "token": body["token"], "user": body["user"]}


def _auth(t):
    return {"Authorization": f"Bearer {t}"}


# ---------- Dynamic holidays (future years) ----------
class TestDynamicHolidays:
    @pytest.mark.parametrize("year", [2028, 2029, 2030])
    def test_year_has_core_holidays(self, session, year):
        r = session.get(f"{API}/holidays?start={year}-01-01&end={year}-12-31")
        assert r.status_code == 200, r.text
        pub = [h for h in r.json()["holidays"] if h.get("type") == "public"]
        names = {h["name"] for h in pub}
        # Core WA holidays that must be present each year
        # NOTE: python-holidays returns "Labor Day" (US spelling); AU official is "Labour Day"
        expected_substrings = ["New Year", "Australia Day",
                               ("Labour Day", "Labor Day"),
                               "Western Australia Day", "King's Birthday",
                               "Christmas", "Boxing"]
        for exp in expected_substrings:
            if isinstance(exp, tuple):
                assert any(any(e in n for e in exp) for n in names), f"{year}: missing any of {exp}. Got: {names}"
            else:
                assert any(exp in n for n in names), f"{year}: missing holiday matching '{exp}'. Got: {names}"

    def test_multi_year_range(self, session):
        r = session.get(f"{API}/holidays?start=2028-01-01&end=2030-12-31")
        assert r.status_code == 200
        pub = [h for h in r.json()["holidays"] if h.get("type") == "public"]
        years_present = {int(h["date"][:4]) for h in pub}
        assert {2028, 2029, 2030}.issubset(years_present)


# ---------- Admin refresh endpoint ----------
class TestAdminRefresh:
    def test_regular_user_forbidden(self, session, user_ctx):
        r = session.post(f"{API}/admin/holidays/refresh", headers=_auth(user_ctx["token"]))
        assert r.status_code == 403

    def test_unauth_401(self, session):
        r = session.post(f"{API}/admin/holidays/refresh")
        assert r.status_code == 401

    def test_admin_success(self, session, admin_ctx):
        r = session.post(f"{API}/admin/holidays/refresh", headers=_auth(admin_ctx["token"]))
        assert r.status_code == 200
        data = r.json()
        assert "refreshed" in data
        refreshed = data["refreshed"]
        # Keys may be strings (JSON) or ints
        assert len(refreshed) >= 3
        # Every value should be > 0 (WA has several holidays each year)
        for _, count in refreshed.items():
            assert isinstance(count, int) and count > 5


# ---------- Personal leave CRUD ----------
class TestLeavesCRUD:
    def test_leaves_requires_auth(self, session):
        r = session.get(f"{API}/leaves")
        assert r.status_code == 401

    def test_initial_empty_and_add_delete(self, session, user_ctx):
        # Initial list
        r = session.get(f"{API}/leaves", headers=_auth(user_ctx["token"]))
        assert r.status_code == 200
        initial = r.json()["leaves"]
        # Pick a future working day (5 weeks from now on a Monday)
        today = date.today()
        target = today + timedelta(days=(7 - today.weekday()) + 28)  # 4 weeks later Monday
        leave_date = target.isoformat()

        # Add leave
        r = session.post(f"{API}/leaves",
                         headers=_auth(user_ctx["token"]),
                         json={"date": leave_date, "note": "Doctor appt"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["date"] == leave_date
        assert body["note"] == "Doctor appt"
        assert "id" in body and "created_at" in body
        leave_id = body["id"]

        # GET again — verify persisted
        r = session.get(f"{API}/leaves", headers=_auth(user_ctx["token"]))
        leaves_after = r.json()["leaves"]
        assert any(lv["date"] == leave_date for lv in leaves_after)
        assert len(leaves_after) == len(initial) + 1

        # Duplicate → 409
        r = session.post(f"{API}/leaves",
                         headers=_auth(user_ctx["token"]),
                         json={"date": leave_date, "note": "dup"})
        assert r.status_code == 409

        # Bad date format
        r = session.post(f"{API}/leaves",
                         headers=_auth(user_ctx["token"]),
                         json={"date": "not-a-date"})
        assert r.status_code == 422

        # Delete non-existent
        r = session.delete(f"{API}/leaves/nonexistent-id-xyz",
                           headers=_auth(user_ctx["token"]))
        assert r.status_code == 404

        # Delete real
        r = session.delete(f"{API}/leaves/{leave_id}",
                           headers=_auth(user_ctx["token"]))
        assert r.status_code == 200

        # Verify gone
        r = session.get(f"{API}/leaves", headers=_auth(user_ctx["token"]))
        assert not any(lv["id"] == leave_id for lv in r.json()["leaves"])

    def test_cannot_delete_other_users_leave(self, session, user_ctx, admin_ctx):
        # User creates a leave; admin tries to delete
        today = date.today()
        d = (today + timedelta(days=35)).isoformat()
        r = session.post(f"{API}/leaves",
                         headers=_auth(user_ctx["token"]),
                         json={"date": d, "note": "x"})
        assert r.status_code == 200
        lid = r.json()["id"]
        # Admin tries to delete — should be 404 (belongs to another user)
        r = session.delete(f"{API}/leaves/{lid}",
                           headers=_auth(admin_ctx["token"]))
        assert r.status_code == 404
        # Cleanup
        session.delete(f"{API}/leaves/{lid}", headers=_auth(user_ctx["token"]))


# ---------- Roster integration with leaves ----------
class TestRosterLeaveIntegration:
    def test_leave_overrides_regular_day(self, session, user_ctx):
        # Pick a Monday 6 weeks ahead (should be a regular working day)
        today = date.today()
        target = today + timedelta(days=(7 - today.weekday()) + 42)  # future Monday
        leave_date = target.isoformat()

        # First check baseline — that day should be a working day (regular or short/day_off)
        r = session.get(
            f"{API}/roster/me?start={leave_date}&days=3",
            headers=_auth(user_ctx["token"]),
        )
        assert r.status_code == 200
        base_days = {d["date"]: d for d in r.json()["days"]}
        neighbor_iso = (target + timedelta(days=1)).isoformat()
        base_neighbor = base_days[neighbor_iso]

        # Add leave
        r = session.post(f"{API}/leaves",
                         headers=_auth(user_ctx["token"]),
                         json={"date": leave_date, "note": "Family day"})
        assert r.status_code == 200
        lid = r.json()["id"]

        # Fetch roster again — target day should be 'leave'
        r = session.get(
            f"{API}/roster/me?start={leave_date}&days=3",
            headers=_auth(user_ctx["token"]),
        )
        days = {d["date"]: d for d in r.json()["days"]}
        t = days[leave_date]
        assert t["status"] == "leave"
        assert t["hours"] == 0
        assert t["label"] == "Personal leave"
        assert t["leave_note"] == "Family day"

        # Neighbor unchanged
        n = days[neighbor_iso]
        assert n["status"] == base_neighbor["status"]
        assert n["hours"] == base_neighbor["hours"]

        # Cleanup
        session.delete(f"{API}/leaves/{lid}", headers=_auth(user_ctx["token"]))

    def test_today_endpoint_returns_leave_when_today_marked(self, session):
        # Register a fresh PT user with today marked as a working day so
        # today qualifies for leave. Uses PT to sidestep FT day-count rules.
        pin = _rand_pin()
        today_dow = date.today().weekday()
        r = session.post(f"{API}/auth/register", json={
            "name": "TEST Today Leave",
            "pin": pin,
            "working_days": [today_dow],
            "employment_type": "PT",
            "pt_day_hours": {str(today_dow): 6},
            "has_lunch_break": False,
        })
        assert r.status_code == 200, r.text
        token = r.json()["token"]
        today_iso = date.today().isoformat()

        # Add today as leave
        r = session.post(f"{API}/leaves",
                         headers=_auth(token),
                         json={"date": today_iso, "note": "Sick today"})
        assert r.status_code == 200, r.text

        r = session.get(f"{API}/roster/today", headers=_auth(token))
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "leave"
        assert data["hours"] == 0
        assert data["leave_note"] == "Sick today"
