import { useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { DatePickerField } from "@/src/components/DatePickerField";
import { colors, spacing, radius } from "@/src/theme/colors";
import type { EmploymentType, FTSchedule } from "@/src/api/client";

const WEEKDAYS = [
  { i: 0, name: "Mon" },
  { i: 1, name: "Tue" },
  { i: 2, name: "Wed" },
  { i: 3, name: "Thu" },
  { i: 4, name: "Fri" },
  { i: 5, name: "Sat" },
  { i: 6, name: "Sun" },
];

const FT_REQUIRED_DAYS: Record<FTSchedule, number> = {
  fortnight_9: 5,
  daily_8: 5,
  daily_9_5: 4,
};

const FT_DEFAULT_DAYS: Record<FTSchedule, number[]> = {
  fortnight_9: [0, 1, 2, 3, 4],
  daily_8: [0, 1, 2, 3, 4],
  daily_9_5: [0, 1, 2, 3],
};

export type ScheduleFormState = {
  employmentType: EmploymentType;
  ftSchedule: FTSchedule;
  workingDays: number[];
  dayOffDate: string; // YYYY-MM-DD, only fortnight_9
  ptDayHours: Record<string, string>; // string for TextInput
  hasLunchBreak: boolean;
};

export function initialScheduleState(): ScheduleFormState {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return {
    employmentType: "FT",
    ftSchedule: "fortnight_9",
    workingDays: [0, 1, 2, 3, 4],
    dayOffDate: `${y}-${m}-${day}`,
    ptDayHours: {},
    hasLunchBreak: true,
  };
}

type Props = {
  value: ScheduleFormState;
  onChange: (v: ScheduleFormState) => void;
};

export function ScheduleForm({ value, onChange }: Props) {
  const requiredDayCount =
    value.employmentType === "FT" ? FT_REQUIRED_DAYS[value.ftSchedule] : null;

  const toggleDay = (i: number) => {
    const has = value.workingDays.includes(i);
    if (has) {
      // Always allow removing
      const next = value.workingDays.filter((x) => x !== i);
      const nextHours = { ...value.ptDayHours };
      delete nextHours[String(i)];
      onChange({ ...value, workingDays: next, ptDayHours: nextHours });
      return;
    }
    // Adding — respect FT cap
    if (requiredDayCount !== null && value.workingDays.length >= requiredDayCount) {
      return; // cap reached; ignore tap
    }
    const next = [...value.workingDays, i].sort();
    onChange({ ...value, workingDays: next });
  };

  const setEmploymentType = (et: EmploymentType) => {
    if (et === value.employmentType) return;
    if (et === "FT") {
      // Reset working days to fit current FT schedule requirement
      onChange({
        ...value,
        employmentType: "FT",
        workingDays: FT_DEFAULT_DAYS[value.ftSchedule].slice(),
      });
    } else {
      onChange({ ...value, employmentType: "PT" });
    }
  };

  const setFTSchedule = (s: FTSchedule) => {
    if (s === value.ftSchedule) return;
    // Auto-adjust working days to the required count for the new schedule.
    onChange({
      ...value,
      ftSchedule: s,
      workingDays: FT_DEFAULT_DAYS[s].slice(),
    });
  };

  const setPTHours = (dow: number, text: string) => {
    const cleaned = text.replace(/[^0-9.]/g, "").slice(0, 5);
    onChange({
      ...value,
      ptDayHours: { ...value.ptDayHours, [String(dow)]: cleaned },
    });
  };

  const setDayOff = (d: string) => onChange({ ...value, dayOffDate: d });
  const setLunch = (b: boolean) => onChange({ ...value, hasLunchBreak: b });

  const anyPTDayOver6 = useMemo(() => {
    if (value.employmentType !== "PT") return false;
    return value.workingDays.some((dow) => {
      const raw = value.ptDayHours[String(dow)];
      const n = parseFloat(raw || "0");
      return isFinite(n) && n > 6;
    });
  }, [value.employmentType, value.workingDays, value.ptDayHours]);

  const showLunchToggle = useMemo(() => {
    // Fortnight_9 already bakes in lunch — hide the toggle to avoid confusion.
    if (value.employmentType === "FT" && value.ftSchedule === "fortnight_9") {
      return false;
    }
    // Part-time: show only if at least one selected day has >6 hours.
    if (value.employmentType === "PT") {
      return anyPTDayOver6;
    }
    // FT daily_9_5 / daily_8: always show.
    return true;
  }, [value.employmentType, value.ftSchedule, anyPTDayOver6]);

  const showDayOff =
    value.employmentType === "FT" && value.ftSchedule === "fortnight_9";
  const showPTHours = value.employmentType === "PT";

  const scheduleHint = useMemo(() => {
    if (value.employmentType === "PT") {
      const parts = ["Pick each day you work and how many hours you're at work that day."];
      if (anyPTDayOver6) {
        parts.push("Days over 6h can include a 30-min unpaid lunch break — tick the box below if you take one.");
      }
      return parts.join(" ");
    }
    if (value.ftSchedule === "fortnight_9") {
      return "Every second week you get 1 day off and 1 short 8h day (30 min lunch already excluded). Requires exactly 5 working days.";
    }
    if (value.ftSchedule === "daily_9_5") {
      return value.hasLunchBreak
        ? "9.5h paid per working day (30 min unpaid lunch). Requires exactly 4 working days."
        : "10h paid per working day (no lunch break). Requires exactly 4 working days.";
    }
    if (value.ftSchedule === "daily_8") {
      return value.hasLunchBreak
        ? "8h paid per working day (30 min unpaid lunch). Requires exactly 5 working days."
        : "8.5h paid per working day (no lunch break). Requires exactly 5 working days.";
    }
    return "";
  }, [value.employmentType, value.ftSchedule, value.hasLunchBreak, anyPTDayOver6]);

  return (
    <View>
      {/* Employment type */}
      <Text style={styles.label}>Employment type</Text>
      <View style={styles.segment}>
        {(["FT", "PT"] as EmploymentType[]).map((et) => {
          const active = value.employmentType === et;
          const long = et === "FT" ? "Full time" : "Part time";
          return (
            <TouchableOpacity
              key={et}
              testID={`et-${et}`}
              onPress={() => setEmploymentType(et)}
              style={[styles.segBtn, active && styles.segBtnActive]}
            >
              <Text
                style={[styles.segText, active && styles.segTextActive]}
              >
                {et} · {long}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* FT sub-schedule */}
      {value.employmentType === "FT" && (
        <>
          <Text style={styles.label}>Full-time schedule</Text>
          <View style={styles.pillCol}>
            <SchedulePill
              testID="sched-fortnight_9"
              active={value.ftSchedule === "fortnight_9"}
              title="9-day fortnight"
              subtitle="5 days a week · rotating day off + 8h short day"
              onPress={() => setFTSchedule("fortnight_9")}
            />
            <SchedulePill
              testID="sched-daily_9_5"
              active={value.ftSchedule === "daily_9_5"}
              title="9.5h per day"
              subtitle="Choose 4 days a week"
              onPress={() => setFTSchedule("daily_9_5")}
            />
            <SchedulePill
              testID="sched-daily_8"
              active={value.ftSchedule === "daily_8"}
              title="8h per day"
              subtitle="Choose 5 days a week"
              onPress={() => setFTSchedule("daily_8")}
            />
          </View>
        </>
      )}

      {/* Working days */}
      <View style={styles.labelRow}>
        <Text style={styles.labelInline}>Working days</Text>
        {requiredDayCount !== null && (
          <Text style={styles.dayCountHint}>
            {value.workingDays.length} / {requiredDayCount} selected
          </Text>
        )}
      </View>
      <View style={styles.daysRow}>
        {WEEKDAYS.map((w) => {
          const selected = value.workingDays.includes(w.i);
          const atCap =
            requiredDayCount !== null &&
            !selected &&
            value.workingDays.length >= requiredDayCount;
          return (
            <TouchableOpacity
              key={w.i}
              testID={`working-day-${w.i}`}
              onPress={() => toggleDay(w.i)}
              disabled={atCap}
              style={[
                styles.dayChip,
                selected && styles.dayChipActive,
                atCap && styles.dayChipDisabled,
              ]}
            >
              <Text
                style={[
                  styles.dayChipText,
                  selected && styles.dayChipTextActive,
                  atCap && styles.dayChipTextDisabled,
                ]}
              >
                {w.name}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* PT per-day hours */}
      {showPTHours && (
        <>
          <Text style={styles.label}>Hours per day</Text>
          {value.workingDays.length === 0 ? (
            <Text style={styles.help}>
              Pick your working days above to enter hours.
            </Text>
          ) : (
            <View style={styles.hoursList}>
              {value.workingDays.map((dow) => {
                const wd = WEEKDAYS.find((w) => w.i === dow)!;
                return (
                  <View style={styles.hoursRow} key={dow}>
                    <Text style={styles.hoursDay}>{wd.name}</Text>
                    <TextInput
                      testID={`pt-hours-${dow}`}
                      value={value.ptDayHours[String(dow)] || ""}
                      onChangeText={(t) => setPTHours(dow, t)}
                      placeholder="e.g. 6"
                      placeholderTextColor={colors.muted}
                      style={styles.hoursInput}
                      keyboardType="decimal-pad"
                      maxLength={5}
                    />
                    <Text style={styles.hoursUnit}>hours</Text>
                  </View>
                );
              })}
            </View>
          )}
        </>
      )}

      {/* Day-off date for fortnight_9 */}
      {showDayOff && (
        <>
          <Text style={styles.label}>Upcoming day-off (anchor)</Text>
          <DatePickerField
            testID="input-dayoff"
            value={value.dayOffDate}
            onChange={setDayOff}
            minimumDate={new Date()}
            label="Pick your day-off"
          />
          <Text style={styles.help}>
            This is a day-off in your fortnight cycle. The day before it becomes
            your 8h short day; the roster rotates every fortnight.
          </Text>
        </>
      )}

      {/* Lunch break toggle */}
      {showLunchToggle && (
        <TouchableOpacity
          testID="lunch-toggle"
          onPress={() => setLunch(!value.hasLunchBreak)}
          style={styles.lunchRow}
          activeOpacity={0.7}
        >
          <View
            style={[
              styles.checkbox,
              value.hasLunchBreak && styles.checkboxOn,
            ]}
          >
            {value.hasLunchBreak && (
              <Ionicons name="checkmark" size={14} color="#fff" />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.lunchTitle}>Take 30-min unpaid lunch break</Text>
            <Text style={styles.lunchHint}>
              {value.employmentType === "PT"
                ? "For your records — your entered hours are treated as paid hours."
                : "Deducts 30 minutes from each working day's paid hours."}
            </Text>
          </View>
        </TouchableOpacity>
      )}

      {!!scheduleHint && (
        <View style={styles.hintBox}>
          <Ionicons name="information-circle-outline" size={14} color={colors.brand} />
          <Text style={styles.hintText}>{scheduleHint}</Text>
        </View>
      )}
    </View>
  );
}

function SchedulePill({
  active,
  title,
  subtitle,
  onPress,
  testID,
}: {
  active: boolean;
  title: string;
  subtitle: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      style={[styles.pillRow, active && styles.pillRowActive]}
      activeOpacity={0.7}
    >
      <View style={styles.pillLeft}>
        <View
          style={[
            styles.radio,
            active && { borderColor: colors.brand },
          ]}
        >
          {active && <View style={styles.radioInner} />}
        </View>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.pillTitle, active && { color: colors.brand }]}>
          {title}
        </Text>
        <Text style={styles.pillSub}>{subtitle}</Text>
      </View>
    </TouchableOpacity>
  );
}

/** Convert form state to server payload. Throws Error on invalid input. */
export function scheduleStateToPayload(v: ScheduleFormState) {
  if (v.workingDays.length === 0) {
    throw new Error("Select at least one working day");
  }
  if (v.employmentType === "PT") {
    const hours: Record<string, number> = {};
    for (const dow of v.workingDays) {
      const raw = (v.ptDayHours[String(dow)] || "").trim();
      if (!raw) throw new Error("Enter hours for every selected day");
      const n = parseFloat(raw);
      if (!isFinite(n) || n <= 0 || n > 14) {
        throw new Error("Hours per day must be between 0 and 14");
      }
      hours[String(dow)] = n;
    }
    return {
      employment_type: "PT" as const,
      ft_schedule: null,
      working_days: v.workingDays,
      initial_day_off_date: null,
      pt_day_hours: hours,
      has_lunch_break: v.hasLunchBreak,
    };
  }

  // FT: enforce required day counts
  const required = FT_REQUIRED_DAYS[v.ftSchedule];
  if (v.workingDays.length !== required) {
    const label =
      v.ftSchedule === "fortnight_9"
        ? "9-day fortnight"
        : v.ftSchedule === "daily_9_5"
          ? "9.5h per day"
          : "8h per day";
    throw new Error(`${label} requires exactly ${required} working days a week`);
  }

  if (v.ftSchedule === "fortnight_9") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.dayOffDate)) {
      throw new Error("Day-off date must be YYYY-MM-DD");
    }
    const isoDow =
      (new Date(v.dayOffDate + "T00:00:00").getDay() + 6) % 7;
    if (!v.workingDays.includes(isoDow)) {
      throw new Error("Day-off must be one of your working days");
    }
    return {
      employment_type: "FT" as const,
      ft_schedule: "fortnight_9" as const,
      working_days: v.workingDays,
      initial_day_off_date: v.dayOffDate,
      pt_day_hours: null,
      has_lunch_break: true, // baked-in for fortnight_9
    };
  }
  return {
    employment_type: "FT" as const,
    ft_schedule: v.ftSchedule,
    working_days: v.workingDays,
    initial_day_off_date: null,
    pt_day_hours: null,
    has_lunch_break: v.hasLunchBreak,
  };
}

/** Convert saved user record back into form state. */
export function userToScheduleState(u: {
  employment_type?: string;
  ft_schedule?: string | null;
  working_days: number[];
  initial_day_off_date?: string | null;
  pt_day_hours?: Record<string, number> | null;
  has_lunch_break?: boolean;
}): ScheduleFormState {
  const base = initialScheduleState();
  const et = (u.employment_type as EmploymentType) || "FT";
  const sched = (u.ft_schedule as FTSchedule) || "fortnight_9";
  const ptHours: Record<string, string> = {};
  if (u.pt_day_hours) {
    for (const [k, v] of Object.entries(u.pt_day_hours)) {
      ptHours[k] = String(v);
    }
  }
  return {
    ...base,
    employmentType: et,
    ftSchedule: sched,
    workingDays: (u.working_days || []).slice().sort(),
    dayOffDate: u.initial_day_off_date || base.dayOffDate,
    ptDayHours: ptHours,
    hasLunchBreak: u.has_lunch_break !== false,
  };
}

const styles = StyleSheet.create({
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.onSurfaceTertiary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  labelInline: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.onSurfaceTertiary,
  },
  dayCountHint: {
    fontSize: 12,
    color: colors.onSurfaceTertiary,
    fontWeight: "600",
  },
  segment: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  segBtn: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.pill,
    alignItems: "center",
  },
  segBtnActive: { backgroundColor: colors.brand },
  segText: { color: colors.onSurface, fontWeight: "700", fontSize: 13 },
  segTextActive: { color: "#fff" },
  pillCol: { gap: spacing.sm },
  pillRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pillRowActive: {
    borderColor: colors.brand,
    backgroundColor: colors.brandTertiary,
  },
  pillLeft: {},
  pillTitle: { fontWeight: "700", color: colors.onSurface, fontSize: 14 },
  pillSub: {
    color: colors.onSurfaceTertiary,
    fontSize: 12,
    marginTop: 2,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.brand,
  },
  daysRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  dayChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    minWidth: 56,
    alignItems: "center",
  },
  dayChipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  dayChipDisabled: {
    opacity: 0.35,
  },
  dayChipText: { color: colors.onSurface, fontWeight: "600" },
  dayChipTextActive: { color: "#fff" },
  dayChipTextDisabled: { color: colors.muted },
  help: {
    color: colors.onSurfaceTertiary,
    fontSize: 12,
    marginTop: spacing.sm,
    lineHeight: 18,
  },
  hoursList: {
    gap: spacing.sm,
  },
  hoursRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  hoursDay: {
    width: 44,
    fontWeight: "700",
    color: colors.onSurface,
  },
  hoursInput: {
    flex: 1,
    fontSize: 16,
    color: colors.onSurface,
    paddingVertical: 8,
  },
  hoursUnit: { color: colors.onSurfaceTertiary, fontSize: 12 },
  lunchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.lg,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  checkboxOn: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  lunchTitle: { color: colors.onSurface, fontWeight: "700", fontSize: 14 },
  lunchHint: { color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 2 },
  hintBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.brandTertiary,
    borderRadius: radius.md,
  },
  hintText: { color: colors.onBrandTertiary, fontSize: 12, flex: 1, lineHeight: 18 },
});
