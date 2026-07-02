"""Western Australia public + school holidays.

Public holidays: computed algorithmically via `python-holidays` (WA subdivision).
The library correctly handles Easter, moveable Mondays, and observed dates for
any year — no yearly maintenance required.

School holidays: WA Department of Education publishes term dates 4 years ahead.
Hardcoded as inclusive ranges for 2025-2028. Extend when new dates are released.
"""
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional, Tuple

import holidays as _holidays_lib

# In-process cache — computed once per year on first access.
_WA_CACHE: Dict[int, Dict[str, str]] = {}


def _wa_year(year: int) -> Dict[str, str]:
    """Return {ISO date: holiday name} for WA in the given year."""
    if year not in _WA_CACHE:
        wa = _holidays_lib.Australia(subdiv="WA", years=[year])
        # python-holidays uses US spelling "Labor Day"; WA uses Australian "Labour Day".
        _WA_CACHE[year] = {
            d.isoformat(): name.replace("Labor Day", "Labour Day")
            for d, name in wa.items()
        }
    return _WA_CACHE[year]


# School holiday periods — list of (start, end, label) inclusive.
SCHOOL_HOLIDAYS_RANGES: List[Tuple[str, str, str]] = [
    # 2025
    ("2025-04-12", "2025-04-27", "Term 1 School Holidays"),
    ("2025-07-05", "2025-07-20", "Term 2 School Holidays"),
    ("2025-09-27", "2025-10-12", "Term 3 School Holidays"),
    ("2025-12-13", "2026-02-03", "Summer School Holidays"),

    # 2026
    ("2026-04-04", "2026-04-19", "Term 1 School Holidays"),
    ("2026-07-04", "2026-07-19", "Term 2 School Holidays"),
    ("2026-09-26", "2026-10-11", "Term 3 School Holidays"),
    ("2026-12-19", "2027-02-02", "Summer School Holidays"),

    # 2027
    ("2027-04-10", "2027-04-25", "Term 1 School Holidays"),
    ("2027-07-03", "2027-07-18", "Term 2 School Holidays"),
    ("2027-09-25", "2027-10-10", "Term 3 School Holidays"),
    ("2027-12-18", "2028-02-01", "Summer School Holidays"),

    # 2028
    ("2028-04-08", "2028-04-23", "Term 1 School Holidays"),
    ("2028-07-01", "2028-07-16", "Term 2 School Holidays"),
    ("2028-09-30", "2028-10-15", "Term 3 School Holidays"),
    ("2028-12-16", "2029-02-04", "Summer School Holidays"),
]


def _parse(s: str) -> date:
    return datetime.strptime(s, "%Y-%m-%d").date()


def get_public_holiday(d: date) -> Optional[str]:
    return _wa_year(d.year).get(d.isoformat())


def get_school_holiday(d: date) -> Optional[str]:
    iso = d.isoformat()
    for start, end, label in SCHOOL_HOLIDAYS_RANGES:
        if start <= iso <= end:
            return label
    return None


def refresh_cache(years: Optional[List[int]] = None) -> Dict[int, int]:
    """Force-refresh the public holidays cache for the given years.
    Returns {year: holiday_count}. If no years given, refresh current + next 2."""
    today = date.today()
    if not years:
        years = [today.year, today.year + 1, today.year + 2]
    out: Dict[int, int] = {}
    for y in years:
        _WA_CACHE.pop(y, None)
        out[y] = len(_wa_year(y))
    return out


def list_holidays_between(start: date, end: date) -> List[dict]:
    """Return public (single date) + school (date range) holidays between start-end."""
    out: List[dict] = []
    # Public holidays — iterate years covered.
    for year in range(start.year, end.year + 1):
        for iso, name in _wa_year(year).items():
            d = _parse(iso)
            if start <= d <= end:
                out.append({"date": iso, "name": name, "type": "public"})
    # School holidays intersecting the range.
    for s, e, label in SCHOOL_HOLIDAYS_RANGES:
        rs, re_ = _parse(s), _parse(e)
        if re_ < start or rs > end:
            continue
        out.append({"start": s, "end": e, "name": label, "type": "school"})
    out.sort(key=lambda x: x.get("date") or x.get("start"))
    return out
