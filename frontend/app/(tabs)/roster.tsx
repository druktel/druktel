import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Calendar } from "react-native-calendars";
import { api, RosterResponse, DayEntry } from "@/src/api/client";
import { colors, spacing, radius } from "@/src/theme/colors";

const LEAVE_COLOR = "#7C3AED";
const PUBLIC_HOLIDAY_COLOR = "#DC2626";
const SCHOOL_HOLIDAY_COLOR = "#2563EB";
const TODAY_COLOR = "#F97316";

function formatISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function mondayOf(d: Date) {
  const copy = new Date(d);
  const dow = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - dow);
  return copy;
}

function statusColor(status: DayEntry["status"]) {
  switch (status) {
    case "regular":
      return { bg: colors.brand, text: "#fff", label: "9h" };
    case "short":
      return { bg: colors.warning, text: "#fff", label: "8.5h" };
    case "day_off":
      return { bg: colors.surfaceTertiary, text: colors.onSurfaceTertiary, label: "OFF" };
    case "leave":
      return { bg: LEAVE_COLOR, text: "#fff", label: "LEAVE" };
    case "non_working":
      return { bg: "transparent", text: colors.muted, label: "—" };
  }
}

type ViewMode = "grid" | "calendar";

export default function RosterScreen() {
  const [mode, setMode] = useState<ViewMode>("grid");
  const [start, setStart] = useState<Date>(() => mondayOf(new Date()));
  const [roster, setRoster] = useState<RosterResponse | null>(null);
  const [calendarRoster, setCalendarRoster] = useState<RosterResponse | null>(null);
  const [calendarAround, setCalendarAround] = useState<Date>(() => new Date());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [leaveBusy, setLeaveBusy] = useState(false);

  const load = useCallback(async (s: Date) => {
    setError(null);
    try {
      const r = await api.myRoster(formatISO(s), 14);
      setRoster(r);
    } catch (e: any) {
      setError(e.message || "Failed to load roster");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadCalendar = useCallback(async (aroundDate?: Date) => {
    const center = aroundDate || new Date();
    setCalendarAround(center);
    const s = new Date(center);
    s.setDate(s.getDate() - 35);
    const monday = mondayOf(s);
    try {
      const r = await api.myRoster(formatISO(monday), 105);
      setCalendarRoster(r);
    } catch (e: any) {
      setError(e.message || "Failed to load calendar");
      // Ensure we don't get stuck in infinite loading state
      setCalendarRoster({ start_date: formatISO(monday), end_date: formatISO(monday), days: [] });
    }
  }, []);

  const addLeave = async () => {
    if (!selectedDate) return;
    setLeaveBusy(true);
    try {
      await api.addLeave(selectedDate);
      // Reload both grid and calendar so the new leave shows immediately.
      await Promise.all([load(start), loadCalendar(calendarAround)]);
    } catch (e: any) {
      setError(e.message || "Failed to add leave");
    } finally {
      setLeaveBusy(false);
    }
  };

  const removeLeave = async () => {
    if (!selectedDate) return;
    setLeaveBusy(true);
    try {
      const list = await api.listLeaves();
      const match = list.leaves.find((l) => l.date === selectedDate);
      if (match) {
        await api.deleteLeave(match.id);
      }
      await Promise.all([load(start), loadCalendar(calendarAround)]);
    } catch (e: any) {
      setError(e.message || "Failed to remove leave");
    } finally {
      setLeaveBusy(false);
    }
  };

  useEffect(() => {
    load(start);
  }, [start, load]);

  useEffect(() => {
    if (mode === "calendar" && !calendarRoster) {
      loadCalendar();
    }
  }, [mode, calendarRoster, loadCalendar]);

  const shift = (weeks: number) => {
    const next = new Date(start);
    next.setDate(next.getDate() + weeks * 7);
    setStart(next);
  };

  const week1 = roster?.days.slice(0, 7) || [];
  const week2 = roster?.days.slice(7, 14) || [];
  const week1Hours = week1.reduce((s, d) => s + d.hours, 0);
  const week2Hours = week2.reduce((s, d) => s + d.hours, 0);
  const total = week1Hours + week2Hours;

  const rangeLabel = roster
    ? `${new Date(roster.start_date + "T00:00:00").toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })} – ${new Date(roster.end_date + "T00:00:00").toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })}`
    : "";

  // Calendar markings
  const todayISO = formatISO(new Date());
  const markedDates = useMemo(() => {
    const marks: Record<string, any> = {};
    (calendarRoster?.days || []).forEach((d) => {
      const dots: { color: string; key: string }[] = [];
      let bgColor: string | undefined;
      let textColor: string | undefined;
      if (d.status === "regular") {
        bgColor = colors.brand;
        textColor = "#fff";
      } else if (d.status === "short") {
        bgColor = colors.warning;
        textColor = "#fff";
      } else if (d.status === "leave") {
        bgColor = LEAVE_COLOR;
        textColor = "#fff";
      } else if (d.status === "day_off") {
        bgColor = colors.surfaceTertiary;
        textColor = colors.onSurface;
      }
      if (d.public_holiday) {
        dots.push({ color: PUBLIC_HOLIDAY_COLOR, key: "ph" });
      }
      if (d.school_holiday) {
        dots.push({ color: SCHOOL_HOLIDAY_COLOR, key: "sh" });
      }
      // Border precedence: today (orange) > public holiday (red) > none
      let borderColor: string | undefined;
      let borderWidth = 0;
      if (d.date === todayISO) {
        borderColor = TODAY_COLOR;
        borderWidth = 2.5;
      } else if (d.public_holiday) {
        borderColor = PUBLIC_HOLIDAY_COLOR;
        borderWidth = 2;
      }
      marks[d.date] = {
        customStyles: {
          container: {
            backgroundColor: bgColor || "transparent",
            borderRadius: 10,
            borderColor: borderColor || "transparent",
            borderWidth,
          },
          text: {
            color: textColor || colors.onSurface,
            fontWeight: d.date === todayISO ? "800" : "500",
          },
        },
        dots,
      };
    });
    if (selectedDate) {
      marks[selectedDate] = {
        ...(marks[selectedDate] || {}),
        selected: true,
        selectedColor: colors.brand,
      };
    }
    return marks;
  }, [calendarRoster, selectedDate, todayISO]);

  const selectedEntry = calendarRoster?.days.find((d) => d.date === selectedDate) || null;

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>My Roster</Text>
        <View style={styles.viewToggle}>
          <TouchableOpacity
            testID="view-mode-grid"
            style={[styles.toggleBtn, mode === "grid" && styles.toggleBtnActive]}
            onPress={() => setMode("grid")}
          >
            <Ionicons
              name="grid-outline"
              size={16}
              color={mode === "grid" ? "#fff" : colors.onSurface}
            />
            <Text
              style={[
                styles.toggleText,
                mode === "grid" && styles.toggleTextActive,
              ]}
            >
              Grid
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="view-mode-calendar"
            style={[styles.toggleBtn, mode === "calendar" && styles.toggleBtnActive]}
            onPress={() => setMode("calendar")}
          >
            <Ionicons
              name="calendar-outline"
              size={16}
              color={mode === "calendar" ? "#fff" : colors.onSurface}
            />
            <Text
              style={[
                styles.toggleText,
                mode === "calendar" && styles.toggleTextActive,
              ]}
            >
              Calendar
            </Text>
          </TouchableOpacity>
        </View>

        {mode === "grid" && (
          <View style={styles.navRow}>
            <TouchableOpacity
              testID="roster-prev"
              style={styles.navBtn}
              onPress={() => shift(-2)}
            >
              <Ionicons name="chevron-back" size={20} color={colors.onSurface} />
            </TouchableOpacity>
            <Text style={styles.range}>{rangeLabel}</Text>
            <TouchableOpacity
              testID="roster-next"
              style={styles.navBtn}
              onPress={() => shift(2)}
            >
              <Ionicons name="chevron-forward" size={20} color={colors.onSurface} />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {mode === "grid" ? (
        loading ? (
          <View style={styles.center} testID="roster-loading">
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : error ? (
          <View style={styles.center} testID="roster-error">
            <Text style={{ color: colors.error }}>{error}</Text>
            <TouchableOpacity onPress={() => load(start)} style={styles.retryBtn}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.scroll}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  load(start);
                }}
                tintColor={colors.brand}
              />
            }
          >
            <WeekBlock title="Week 1" days={week1} totalHours={week1Hours} testIDPrefix="w1" />
            <WeekBlock title="Week 2" days={week2} totalHours={week2Hours} testIDPrefix="w2" />

            <View style={styles.totalCard} testID="fortnight-total">
              <Text style={styles.totalLabel}>Fortnight total</Text>
              <Text style={styles.totalValue}>{total.toFixed(1)}h</Text>
            </View>

            <Legend />
            <Text style={styles.footNote}>
              All shifts include a 30 min lunch break. Short day always falls
              before your day off; when the day off is your earliest working
              day of the week, the short day is your latest working day of the
              same week.
            </Text>
          </ScrollView>
        )
      ) : (
        // CALENDAR VIEW
        <ScrollView contentContainerStyle={styles.scroll}>
          {!calendarRoster ? (
            <View style={styles.center} testID="calendar-loading">
              <ActivityIndicator color={colors.brand} />
            </View>
          ) : (
            <>
              <View style={styles.calendarWrap} testID="calendar-view">
                <Calendar
                  current={formatISO(new Date())}
                  markingType="custom"
                  markedDates={markedDates}
                  onDayPress={(day) => setSelectedDate(day.dateString)}
                  onMonthChange={(m) => {
                    loadCalendar(new Date(m.dateString + "T00:00:00"));
                  }}
                  theme={{
                    backgroundColor: colors.surfaceSecondary,
                    calendarBackground: colors.surfaceSecondary,
                    textSectionTitleColor: colors.onSurfaceTertiary,
                    todayTextColor: TODAY_COLOR,
                    dayTextColor: colors.onSurface,
                    textDisabledColor: colors.muted,
                    monthTextColor: colors.onSurface,
                    arrowColor: colors.brand,
                    textMonthFontWeight: "700",
                  }}
                />
              </View>

              {selectedEntry ? (
                <DayDetailCard
                  entry={selectedEntry}
                  onAddLeave={addLeave}
                  onRemoveLeave={removeLeave}
                  busy={leaveBusy}
                />
              ) : (
                <Text style={styles.hint}>Tap a date to see details.</Text>
              )}

              <Legend showHolidays />
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function WeekBlock({
  title,
  days,
  totalHours,
  testIDPrefix,
}: {
  title: string;
  days: DayEntry[];
  totalHours: number;
  testIDPrefix: string;
}) {
  return (
    <View style={styles.weekCard} testID={`${testIDPrefix}-block`}>
      <View style={styles.weekHeader}>
        <Text style={styles.weekTitle}>{title}</Text>
        <Text style={styles.weekHours}>{totalHours.toFixed(1)}h</Text>
      </View>
      <View style={styles.daysGrid}>
        {days.map((d) => {
          const c = statusColor(d.status);
          const isColored =
            d.status === "regular" ||
            d.status === "short" ||
            d.status === "leave";
          return (
            <View
              key={d.date}
              testID={`${testIDPrefix}-day-${d.date}`}
              style={[
                styles.dayCell,
                { backgroundColor: c.bg },
                !isColored && styles.dayCellSoft,
                d.public_holiday ? styles.dayCellPublicHoliday : null,
                d.is_today ? styles.dayCellToday : null,
              ]}
            >
              {d.public_holiday && (
                <View style={styles.phBadge} testID={`${testIDPrefix}-ph-badge-${d.date}`}>
                  <Text style={styles.phBadgeText}>PH</Text>
                </View>
              )}
              <Text
                style={[
                  styles.dayName,
                  { color: isColored ? "rgba(255,255,255,0.85)" : colors.onSurfaceTertiary },
                ]}
              >
                {d.weekday_name}
              </Text>
              <Text
                style={[
                  styles.dayDate,
                  { color: isColored ? "#fff" : colors.onSurface },
                ]}
              >
                {new Date(d.date + "T00:00:00").getDate()}
              </Text>
              <Text style={[styles.dayLabel, { color: c.text }]}>{c.label}</Text>
              {d.school_holiday && (
                <View style={styles.dotRow} testID={`${testIDPrefix}-sh-dot-${d.date}`}>
                  <View style={[styles.tinyDot, { backgroundColor: SCHOOL_HOLIDAY_COLOR }]} />
                </View>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

function DayDetailCard({
  entry,
  onAddLeave,
  onRemoveLeave,
  busy,
}: {
  entry: DayEntry;
  onAddLeave: () => void;
  onRemoveLeave: () => void;
  busy: boolean;
}) {
  const c = statusColor(entry.status);
  const isWorking = entry.status === "regular" || entry.status === "short";
  const isLeave = entry.status === "leave";
  const statusLabel =
    entry.status === "regular"
      ? "Regular shift"
      : entry.status === "short"
        ? "Short day"
        : entry.status === "day_off"
          ? "Day off"
          : entry.status === "leave"
            ? "Personal leave"
            : "Weekend";
  return (
    <View style={styles.detailCard} testID="day-detail-card">
      <View style={styles.detailHeader}>
        <View>
          <Text style={styles.detailDate}>
            {new Date(entry.date + "T00:00:00").toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </Text>
          <Text style={styles.detailStatus}>{statusLabel}</Text>
        </View>
        <View style={[styles.detailBadge, { backgroundColor: c.bg }]}>
          <Text style={[styles.detailBadgeText, { color: c.text }]}>{c.label}</Text>
        </View>
      </View>
      {isWorking && (
        <Text style={styles.detailHelp}>
          {entry.hours.toFixed(1)} hours including 30 min lunch break
        </Text>
      )}
      {isLeave && entry.leave_note && (
        <Text style={styles.detailHelp}>Note: {entry.leave_note}</Text>
      )}
      {entry.public_holiday && (
        <View style={styles.holidayTag}>
          <View style={[styles.tinyDot, { backgroundColor: PUBLIC_HOLIDAY_COLOR }]} />
          <Text style={styles.holidayText}>Public holiday: {entry.public_holiday}</Text>
        </View>
      )}
      {entry.school_holiday && (
        <View style={styles.holidayTag}>
          <View style={[styles.tinyDot, { backgroundColor: SCHOOL_HOLIDAY_COLOR }]} />
          <Text style={styles.holidayText}>{entry.school_holiday}</Text>
        </View>
      )}

      {isLeave ? (
        <TouchableOpacity
          testID="remove-leave-btn"
          style={[styles.leaveBtn, styles.leaveBtnRemove, busy && { opacity: 0.6 }]}
          onPress={onRemoveLeave}
          disabled={busy}
        >
          <Ionicons name="trash-outline" size={16} color={colors.error} />
          <Text style={[styles.leaveBtnText, { color: colors.error }]}>
            Remove personal leave
          </Text>
        </TouchableOpacity>
      ) : (
        entry.status !== "non_working" && (
          <TouchableOpacity
            testID="add-leave-btn"
            style={[styles.leaveBtn, styles.leaveBtnAdd, busy && { opacity: 0.6 }]}
            onPress={onAddLeave}
            disabled={busy}
          >
            <Ionicons name="airplane-outline" size={16} color="#7C3AED" />
            <Text style={[styles.leaveBtnText, { color: "#7C3AED" }]}>
              Mark as personal leave
            </Text>
          </TouchableOpacity>
        )
      )}
    </View>
  );
}

function Legend({ showHolidays }: { showHolidays?: boolean } = {}) {
  return (
    <View style={styles.legend}>
      <LegendItem color={colors.brand} label="9h shift" />
      <LegendItem color={colors.warning} label="8.5h short" />
      <LegendItem color={colors.surfaceTertiary} label="Day off" isLight />
      <LegendItem color={LEAVE_COLOR} label="Personal leave" />
      <View style={styles.legendItem}>
        <View style={styles.legendTodaySwatch} />
        <Text style={styles.legendText}>Today</Text>
      </View>
      {showHolidays && (
        <>
          <LegendItem color={PUBLIC_HOLIDAY_COLOR} label="WA public holiday" isDot />
          <LegendItem color={SCHOOL_HOLIDAY_COLOR} label="WA school holidays" isDot />
        </>
      )}
    </View>
  );
}

function LegendItem({
  color,
  label,
  isLight,
  isDot,
}: {
  color: string;
  label: string;
  isLight?: boolean;
  isDot?: boolean;
}) {
  return (
    <View style={styles.legendItem}>
      <View
        style={[
          isDot ? styles.legendDot : styles.legendSwatch,
          { backgroundColor: color, borderWidth: isLight ? 1 : 0, borderColor: colors.border },
        ]}
      />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.md },
  title: { fontSize: 26, fontWeight: "700", color: colors.onSurface },
  viewToggle: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    padding: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignSelf: "flex-start",
  },
  toggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  toggleBtnActive: { backgroundColor: colors.brand },
  toggleText: { color: colors.onSurface, fontWeight: "600", fontSize: 13 },
  toggleTextActive: { color: "#fff" },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.md,
  },
  navBtn: {
    padding: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  range: { color: colors.onSurface, fontWeight: "600" },
  scroll: { padding: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.xxxl },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xxxl },
  retryBtn: {
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.brand,
    borderRadius: radius.md,
  },
  retryText: { color: "#fff", fontWeight: "700" },
  weekCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  weekHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  weekTitle: { fontSize: 16, fontWeight: "700", color: colors.onSurface },
  weekHours: { color: colors.onSurfaceTertiary, fontWeight: "600" },
  daysGrid: { flexDirection: "row", justifyContent: "space-between", gap: 4 },
  dayCell: {
    flex: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    minHeight: 96,
    justifyContent: "space-between",
  },
  dayCellSoft: { backgroundColor: colors.surfaceTertiary },
  dayCellPublicHoliday: {
    borderWidth: 2,
    borderColor: PUBLIC_HOLIDAY_COLOR,
  },
  dayCellToday: {
    borderWidth: 2,
    borderColor: TODAY_COLOR,
  },
  phBadge: {
    position: "absolute",
    top: 2,
    right: 2,
    backgroundColor: PUBLIC_HOLIDAY_COLOR,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    zIndex: 1,
  },
  phBadgeText: {
    color: "#fff",
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  dayName: { fontSize: 10, fontWeight: "700", letterSpacing: 0.5 },
  dayDate: { fontSize: 18, fontWeight: "700", marginTop: 2 },
  dayLabel: { fontSize: 11, fontWeight: "700", marginTop: 4 },
  dotRow: { flexDirection: "row", gap: 3, marginTop: 3 },
  tinyDot: { width: 6, height: 6, borderRadius: 3 },
  totalCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: spacing.lg,
    backgroundColor: colors.brandTertiary,
    borderRadius: radius.md,
    marginTop: spacing.sm,
  },
  totalLabel: { color: colors.onBrandTertiary, fontWeight: "700" },
  totalValue: {
    color: colors.onBrandTertiary,
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  legendSwatch: { width: 16, height: 16, borderRadius: 4 },
  legendTodaySwatch: {
    width: 16,
    height: 16,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: TODAY_COLOR,
    backgroundColor: "transparent",
  },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { color: colors.onSurfaceTertiary, fontSize: 12 },
  footNote: {
    color: colors.onSurfaceTertiary,
    fontSize: 12,
    marginTop: spacing.lg,
    lineHeight: 18,
  },
  calendarWrap: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    marginBottom: spacing.lg,
    overflow: "hidden",
  },
  hint: {
    color: colors.onSurfaceTertiary,
    textAlign: "center",
    marginVertical: spacing.md,
  },
  detailCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  detailHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  detailDate: { color: colors.onSurface, fontWeight: "700", fontSize: 15 },
  detailStatus: { color: colors.onSurfaceTertiary, fontSize: 13, marginTop: 2 },
  detailBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    minWidth: 56,
    alignItems: "center",
  },
  detailBadgeText: { fontWeight: "700", fontSize: 13 },
  detailHelp: { color: colors.onSurfaceTertiary, fontSize: 13 },
  holidayTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
    padding: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
  },
  holidayText: { color: colors.onSurface, fontSize: 13, flex: 1 },
  leaveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  leaveBtnAdd: {
    borderColor: "#7C3AED",
    backgroundColor: "#F5F0FF",
  },
  leaveBtnRemove: {
    borderColor: colors.error,
    backgroundColor: "#FFF5F5",
  },
  leaveBtnText: { fontWeight: "700", fontSize: 14 },
});
