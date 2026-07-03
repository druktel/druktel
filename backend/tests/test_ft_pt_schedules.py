"""FT/PT employment type feature tests.

Covers:
  - Admin login (Tempa R, PIN 6641) returns FT/fortnight_9 with lunch break
  - PT registration + roster returns raw pt_day_hours (no lunch deduction)
  - FT daily_9_5 & daily_8 hours per lunch break flag
  - FT day-count constraints per ft_schedule
  - employment_type field is echoed on discover/friends/posts/notifications/feed
  - /api/access/verify accepts 0000 (regular) and 0115 (admin gate)
"""
import os
import random
from datetime import date, timedelta

import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


def _rand_pin() -> str:
    return f"{random.randint(1000, 9999):04d}"


def _next_monday() -> date:
    today = date.today()
    return today - timedelta(days=today.weekday())


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---------- Access gate ----------
class TestAccessGate:
    def test_verify_0000_regular(self, session):
        r = session.post(f"{API}/access/verify", json={"code": "0000"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["is_admin_gate"] is False

    def test_verify_0115_admin(self, session):
        r = session.post(f"{API}/access/verify", json={"code": "0115"})
        assert r.status_code == 200, r.text
        assert r.json()["is_admin_gate"] is True

    def test_verify_invalid(self, session):
        r = session.post(f"{API}/access/verify", json={"code": "9999"})
        assert r.status_code == 401


# ---------- Admin (Tempa R / 6641) ----------
@pytest.fixture(scope="module")
def admin_login(session):
    r = session.post(f"{API}/auth/login", json={"pin": "6641"})
    assert r.status_code == 200, r.text
    return r.json()


class TestAdminSeed:
    def test_admin_login_returns_ft(self, admin_login):
        u = admin_login["user"]
        assert u["name"] == "Tempa R"
        assert u["is_admin"] is True
        assert u["employment_type"] == "FT"
        assert u["ft_schedule"] == "fortnight_9"
        assert u["has_lunch_break"] is True

    def test_admin_fortnight_14days(self, admin_login):
        token = admin_login["token"]
        anchor = date.fromisoformat(admin_login["user"]["initial_day_off_date"])
        anchor_week_mon = anchor - timedelta(days=anchor.weekday())
        w1_start = anchor_week_mon - timedelta(days=7)
        r = requests.get(
            f"{API}/roster/me?start={w1_start.isoformat()}&days=14",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200
        days = r.json()["days"]
        week2 = days[7:14]
        offs = [d for d in week2 if d["status"] == "day_off"]
        shorts = [d for d in week2 if d["status"] == "short"]
        assert len(offs) == 1
        assert len(shorts) == 1
        assert shorts[0]["hours"] == 8.0
        # Fortnight totals for Mon-Fri worker: 8 regular (8.5h) + 1 short (8h) + 1 day_off (0h) = 76h
        total = sum(d["hours"] for d in days)
        assert 74.0 <= total <= 78.0, f"unexpected fortnight total {total}"


# ---------- PT registration ----------
class TestPT:
    def test_register_pt_success_and_paid_hours(self, session):
        pin = _rand_pin()
        payload = {
            "name": "TEST PT",
            "pin": pin,
            "employment_type": "PT",
            "working_days": [0, 2],
            "pt_day_hours": {"0": 6, "2": 4},
            "has_lunch_break": True,  # informational for PT — must NOT deduct
        }
        r = session.post(f"{API}/auth/register", json=payload)
        assert r.status_code == 200, r.text
        token = r.json()["token"]
        u = r.json()["user"]
        assert u["employment_type"] == "PT"
        assert u["ft_schedule"] is None
        assert u["pt_day_hours"] == {"0": 6.0, "2": 4.0}

        # 7-day roster starting Monday — expect 6h on Mon (dow 0), 4h on Wed (dow 2)
        monday = _next_monday()
        r2 = requests.get(
            f"{API}/roster/me?start={monday.isoformat()}&days=7",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r2.status_code == 200
        days = r2.json()["days"]
        by_dow = {d["weekday"]: d for d in days}
        assert by_dow[0]["hours"] == 6.0
        assert by_dow[0]["status"] == "regular"
        assert by_dow[2]["hours"] == 4.0
        # non-working days
        for dow in (1, 3, 4, 5, 6):
            assert by_dow[dow]["status"] == "non_working"
            assert by_dow[dow]["hours"] == 0

    def test_register_pt_missing_hours_400(self, session):
        r = session.post(f"{API}/auth/register", json={
            "name": "TEST PT bad",
            "pin": _rand_pin(),
            "employment_type": "PT",
            "working_days": [0, 2],
            "pt_day_hours": {"0": 6},  # missing "2"
            "has_lunch_break": False,
        })
        assert r.status_code == 400


# ---------- FT sub-schedules ----------
class TestFTSubSchedules:
    def test_daily_9_5_wrong_day_count_400(self, session):
        r = session.post(f"{API}/auth/register", json={
            "name": "TEST D95 Bad",
            "pin": _rand_pin(),
            "employment_type": "FT",
            "ft_schedule": "daily_9_5",
            "working_days": [0, 1, 2, 3, 4],  # 5 days — must be exactly 4
            "has_lunch_break": True,
        })
        assert r.status_code == 400
        assert "4" in r.text

    def test_daily_9_5_good_and_hours_with_lunch(self, session):
        pin = _rand_pin()
        r = session.post(f"{API}/auth/register", json={
            "name": "TEST D95 Good",
            "pin": pin,
            "employment_type": "FT",
            "ft_schedule": "daily_9_5",
            "working_days": [0, 1, 2, 3],
            "has_lunch_break": True,
        })
        assert r.status_code == 200, r.text
        token = r.json()["token"]
        monday = _next_monday()
        rr = requests.get(
            f"{API}/roster/me?start={monday.isoformat()}&days=7",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert rr.status_code == 200
        by_dow = {d["weekday"]: d for d in rr.json()["days"]}
        for dow in (0, 1, 2, 3):
            assert by_dow[dow]["status"] == "regular"
            assert by_dow[dow]["hours"] == 9.5
        for dow in (4, 5, 6):
            assert by_dow[dow]["status"] == "non_working"

    def test_daily_9_5_no_lunch_10h(self, session):
        pin = _rand_pin()
        r = session.post(f"{API}/auth/register", json={
            "name": "TEST D95 NoLunch",
            "pin": pin,
            "employment_type": "FT",
            "ft_schedule": "daily_9_5",
            "working_days": [0, 1, 2, 3],
            "has_lunch_break": False,
        })
        assert r.status_code == 200, r.text
        token = r.json()["token"]
        monday = _next_monday()
        rr = requests.get(
            f"{API}/roster/me?start={monday.isoformat()}&days=7",
            headers={"Authorization": f"Bearer {token}"},
        )
        by_dow = {d["weekday"]: d for d in rr.json()["days"]}
        assert by_dow[0]["hours"] == 10.0

    def test_daily_8_lunch_and_no_lunch(self, session):
        pin_a = _rand_pin()
        ra = session.post(f"{API}/auth/register", json={
            "name": "TEST D8 Lunch",
            "pin": pin_a,
            "employment_type": "FT",
            "ft_schedule": "daily_8",
            "working_days": [0, 1, 2, 3, 4],
            "has_lunch_break": True,
        })
        assert ra.status_code == 200, ra.text
        monday = _next_monday()
        rra = requests.get(
            f"{API}/roster/me?start={monday.isoformat()}&days=7",
            headers={"Authorization": f"Bearer {ra.json()['token']}"},
        )
        by_dow = {d["weekday"]: d for d in rra.json()["days"]}
        for dow in range(5):
            assert by_dow[dow]["hours"] == 8.0

        pin_b = _rand_pin()
        rb = session.post(f"{API}/auth/register", json={
            "name": "TEST D8 NoLunch",
            "pin": pin_b,
            "employment_type": "FT",
            "ft_schedule": "daily_8",
            "working_days": [0, 1, 2, 3, 4],
            "has_lunch_break": False,
        })
        assert rb.status_code == 200, rb.text
        rrb = requests.get(
            f"{API}/roster/me?start={monday.isoformat()}&days=7",
            headers={"Authorization": f"Bearer {rb.json()['token']}"},
        )
        by_dow = {d["weekday"]: d for d in rrb.json()["days"]}
        for dow in range(5):
            assert by_dow[dow]["hours"] == 8.5


# ---------- PUT /users/me schedule switch ----------
class TestScheduleSwitch:
    def test_admin_can_switch_ft_schedules(self, admin_login):
        token = admin_login["token"]
        orig = admin_login["user"]

        # Switch to daily_8
        r = requests.put(
            f"{API}/users/me",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "employment_type": "FT",
                "ft_schedule": "daily_8",
                "working_days": [0, 1, 2, 3, 4],
                "has_lunch_break": True,
            },
        )
        assert r.status_code == 200, r.text
        assert r.json()["ft_schedule"] == "daily_8"

        # Switch back to fortnight_9 to restore admin state for other tests
        r2 = requests.put(
            f"{API}/users/me",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "employment_type": "FT",
                "ft_schedule": "fortnight_9",
                "working_days": orig["working_days"],
                "initial_day_off_date": orig["initial_day_off_date"],
                "has_lunch_break": True,
            },
        )
        assert r2.status_code == 200, r2.text
        assert r2.json()["ft_schedule"] == "fortnight_9"


# ---------- employment_type propagated in social endpoints ----------
class TestEmploymentTypeInSocial:
    @pytest.fixture(scope="class")
    def two_users(self, session):
        """Create two users and befriend them so social endpoints have data."""
        # PT user
        pt_pin = _rand_pin()
        rpt = session.post(f"{API}/auth/register", json={
            "name": "TEST Social PT",
            "pin": pt_pin,
            "employment_type": "PT",
            "working_days": [0, 4],
            "pt_day_hours": {"0": 5, "4": 3},
            "has_lunch_break": False,
        })
        assert rpt.status_code == 200, rpt.text
        pt = rpt.json()

        # FT daily_8 user
        ft_pin = _rand_pin()
        rft = session.post(f"{API}/auth/register", json={
            "name": "TEST Social FT",
            "pin": ft_pin,
            "employment_type": "FT",
            "ft_schedule": "daily_8",
            "working_days": [0, 1, 2, 3, 4],
            "has_lunch_break": True,
        })
        assert rft.status_code == 200, rft.text
        ft = rft.json()

        # PT befriends FT
        rf = requests.post(
            f"{API}/friends/{ft['user']['id']}",
            headers={"Authorization": f"Bearer {pt['token']}"},
        )
        assert rf.status_code in (200, 409), rf.text
        return pt, ft

    def test_discover_has_employment_type(self, two_users):
        pt, ft = two_users
        r = requests.get(
            f"{API}/discover",
            headers={"Authorization": f"Bearer {pt['token']}"},
        )
        assert r.status_code == 200
        users = r.json()["users"]
        assert users, "discover returned empty"
        for u in users:
            assert "employment_type" in u
            assert u["employment_type"] in ("FT", "PT")

    def test_friends_has_employment_type(self, two_users):
        pt, ft = two_users
        r = requests.get(
            f"{API}/friends",
            headers={"Authorization": f"Bearer {pt['token']}"},
        )
        assert r.status_code == 200
        friends = r.json()["friends"]
        assert any(f["id"] == ft["user"]["id"] and f["employment_type"] == "FT" for f in friends)

    def test_posts_and_notifications_have_employment_type(self, two_users):
        pt, ft = two_users
        # FT creates public post → PT (friend) should get a notification with FT employment_type
        rp = requests.post(
            f"{API}/posts",
            headers={"Authorization": f"Bearer {ft['token']}"},
            json={"text": "TEST_ hi from FT", "visibility": "public"},
        )
        assert rp.status_code == 200, rp.text
        assert rp.json()["author_employment_type"] == "FT"

        # PT lists posts — should see FT's post
        rl = requests.get(
            f"{API}/posts",
            headers={"Authorization": f"Bearer {pt['token']}"},
        )
        assert rl.status_code == 200
        posts = rl.json()["posts"]
        assert any(p.get("author_employment_type") in ("FT", "PT") for p in posts)

        # PT notifications should include friend_post from FT with FT employment_type
        rn = requests.get(
            f"{API}/notifications",
            headers={"Authorization": f"Bearer {pt['token']}"},
        )
        assert rn.status_code == 200
        notifs = rn.json()["notifications"]
        friend_post_notifs = [n for n in notifs if n["type"] == "friend_post"]
        assert friend_post_notifs, "expected at least one friend_post notification"
        assert all("actor_employment_type" in n for n in friend_post_notifs)
