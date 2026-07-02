"""Western Australia public holidays and school holiday periods.
Data compiled from official WA Department of Mines, Industry Regulation and Safety
and WA Department of Education. Hardcoded for 2025-2027 for reliability.
"""
from datetime import date, timedelta
from typing import Dict, Optional, List, Tuple


# Public holidays (single dates) — {ISO date: name}
PUBLIC_HOLIDAYS: Dict[str, str] = {
    # 2025
    "2025-01-01": "New Year's Day",
    "2025-01-27": "Australia Day (observed)",
    "2025-03-03": "Labour Day",
    "2025-04-18": "Good Friday",
    "2025-04-19": "Easter Saturday",
    "2025-04-20": "Easter Sunday",
    "2025-04-21": "Easter Monday",
    "2025-04-25": "ANZAC Day",
    "2025-06-02": "Western Australia Day",
    "2025-09-29": "King's Birthday",
    "2025-12-25": "Christmas Day",
    "2025-12-26": "Boxing Day",

    # 2026
    "2026-01-01": "New Year's Day",
    "2026-01-26": "Australia Day",
    "2026-03-02": "Labour Day",
    "2026-04-03": "Good Friday",
    "2026-04-04": "Easter Saturday",
    "2026-04-05": "Easter Sunday",
    "2026-04-06": "Easter Monday",
    "2026-04-25": "ANZAC Day",
    "2026-06-01": "Western Australia Day",
    "2026-09-28": "King's Birthday",
    "2026-12-25": "Christmas Day",
    "2026-12-26": "Boxing Day",
    "2026-12-28": "Boxing Day (observed)",

    # 2027
    "2027-01-01": "New Year's Day",
    "2027-01-26": "Australia Day",
    "2027-03-01": "Labour Day",
    "2027-03-26": "Good Friday",
    "2027-03-27": "Easter Saturday",
    "2027-03-28": "Easter Sunday",
    "2027-03-29": "Easter Monday",
    "2027-04-25": "ANZAC Day",
    "2027-04-26": "ANZAC Day (observed)",
    "2027-06-07": "Western Australia Day",
    "2027-09-27": "King's Birthday",
    "2027-12-25": "Christmas Day",
    "2027-12-27": "Christmas Day (observed)",
    "2027-12-28": "Boxing Day (observed)",
}


# School holiday periods — list of (start_date, end_date, label) inclusive ranges.
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
]


def _parse(s: str) -> date:
    from datetime import datetime
    return datetime.strptime(s, "%Y-%m-%d").date()


def get_public_holiday(d: date) -> Optional[str]:
    return PUBLIC_HOLIDAYS.get(d.isoformat())


def get_school_holiday(d: date) -> Optional[str]:
    iso = d.isoformat()
    for start, end, label in SCHOOL_HOLIDAYS_RANGES:
        if start <= iso <= end:
            return label
    return None


def list_holidays_between(start: date, end: date) -> List[dict]:
    """Return list of {date, name, type} between start and end inclusive."""
    out: List[dict] = []
    # Public holidays
    for iso, name in PUBLIC_HOLIDAYS.items():
        d = _parse(iso)
        if start <= d <= end:
            out.append({"date": iso, "name": name, "type": "public"})
    # School holidays: emit per-day range or as ranges? Emit as ranges intersecting.
    for s, e, label in SCHOOL_HOLIDAYS_RANGES:
        rs, re_ = _parse(s), _parse(e)
        if re_ < start or rs > end:
            continue
        out.append({
            "start": s,
            "end": e,
            "name": label,
            "type": "school",
        })
    out.sort(key=lambda x: x.get("date") or x.get("start"))
    return out
