# RosterSync — Product Requirements

## Summary
Mobile roster app for shift workers on a 9-day fortnight schedule. Users pick their working days and one anchor day-off date; the app auto-computes each day's status: regular 9h, short 8.5h, day off, or non-working. Every fortnight the day-off (and short day) rotate one working day earlier through the user's working-day list, wrapping to the last working day of the same week when the day-off falls on the first working day. WA public + school holidays are shown as calendar overlays.

## Tech Stack
- Backend: FastAPI + MongoDB (motor)
- Frontend: React Native (Expo, expo-router)
- Auth: unique 4-digit PIN per user, SHA-256 (peppered) hash + session token in AsyncStorage
- Date picker: `@react-native-community/datetimepicker` on native, HTML `<input type="date">` on web
- Calendar: `react-native-calendars`

## Roster Rules
- Week 1 of each fortnight: every working day = 9h (includes 30 min lunch)
- Week 2: one day off + one short day (8.5h including lunch) + regular days
- Short day = the working day BEFORE the day-off in the ordered working_days list
- If day-off is the earliest working day of the week, short day wraps to the last working day of the SAME week
- Non-working weekdays (e.g., Sat/Sun for a Mon–Fri worker) show as "—"

## Holidays
- WA public holidays computed **algorithmically** via `python-holidays` (WA subdivision) for any year — no yearly maintenance
- WA school holiday date ranges hardcoded for 2025–2028 (extend as WA Dept of Education publishes new dates)
- Roster grid + calendar view show holiday dots (red = public, purple = school)
- Admin endpoint `POST /api/admin/holidays/refresh` clears the in-memory cache

## Personal Leave
- Users can mark any date as personal leave (auto-computed roster is overridden → 0h)
- Managed from Settings → "Personal leave days" (add via date-picker + note, delete via trash icon)
- Also add/remove directly from the Roster calendar day-detail card
- Leave days appear in **purple** (`#7C3AED`) across Today, Grid, and Calendar views

## Screens
- `/login` — PIN pad (auto-submits at 4 digits)
- `/register` — name, PIN, working days chips, anchor day-off (**native date picker**), admin toggle
- `(tabs)/index` (Today) — hero card with today's status/hours, fortnight totals, coming-up list
- `(tabs)/roster` — **Grid ↔ Calendar view toggle**; grid = 2-week fortnight with prev/next; calendar = react-native-calendars month with color-coded days + holiday dots, tap-a-day detail card
- `(tabs)/settings` — edit working days + anchor day-off (**native date picker**)
- `(tabs)/admin` — visible only to admins; list of users; tap opens modal with their 2-week grid

## API
- `POST /api/auth/register` `{name, pin, working_days[], initial_day_off_date, is_admin}`
- `POST /api/auth/login` `{pin}`
- `POST /api/auth/logout`
- `GET /api/users/me`
- `PUT /api/users/me` `{working_days[], initial_day_off_date}`
- `GET /api/roster/me?start=YYYY-MM-DD&days=14` — DayEntry now includes `public_holiday`, `school_holiday`, and `leave_note`
- `GET /api/roster/today` — includes holiday + leave fields
- `GET /api/holidays?start=YYYY-MM-DD&end=YYYY-MM-DD` — list of WA public + school holidays (any year)
- `GET /api/leaves` — list my leave days
- `POST /api/leaves` `{date, note?}` — add a leave day (unique per user+date)
- `DELETE /api/leaves/{id}` — remove
- `GET /api/admin/users` (admin)
- `GET /api/admin/roster/{user_id}?start=YYYY-MM-DD&days=14` (admin)
- `POST /api/admin/holidays/refresh` (admin) — refreshes WA holiday cache

## Business enhancement
Team-visibility (admin tab) turns this from a personal utility into a workforce coverage tool — a manager can instantly spot upcoming day-off collisions across the team. WA-specific holiday overlay saves managers from manually cross-checking published calendars.
