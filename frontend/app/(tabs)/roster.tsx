import { useCallback, useEffect, useState } from "react";
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
import { api, RosterResponse, DayEntry } from "@/src/api/client";
import { colors, spacing, radius } from "@/src/theme/colors";

function formatISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function mondayOf(d: Date) {
  const copy = new Date(d);
  const dow = (copy.getDay() + 6) % 7; // Mon=0..Sun=6
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
    case "non_working":
      return { bg: "transparent", text: colors.muted, label: "—" };
  }
}

export default function RosterScreen() {
  const [start, setStart] = useState<Date>(() => mondayOf(new Date()));
  const [roster, setRoster] = useState<RosterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    load(start);
  }, [start, load]);

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

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>My Roster</Text>
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
      </View>

      {loading ? (
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

          <View style={styles.legend}>
            <LegendItem color={colors.brand} label="9h shift" />
            <LegendItem color={colors.warning} label="8.5h short" />
            <LegendItem color={colors.surfaceTertiary} label="Day off" isLight />
          </View>
          <Text style={styles.footNote}>
            All shifts include a 30 min lunch break. Short day always falls
            before your day off; when the day off is your earliest working day
            of the week, the short day is your latest working day of the same
            week.
          </Text>
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
          const isWorking = d.status === "regular" || d.status === "short";
          return (
            <View
              key={d.date}
              testID={`${testIDPrefix}-day-${d.date}`}
              style={[
                styles.dayCell,
                {
                  backgroundColor: c.bg,
                  borderColor: d.is_today ? colors.onSurface : "transparent",
                  borderWidth: d.is_today ? 2 : 0,
                },
                !isWorking && styles.dayCellSoft,
              ]}
            >
              <Text
                style={[
                  styles.dayName,
                  { color: isWorking ? "rgba(255,255,255,0.85)" : colors.onSurfaceTertiary },
                ]}
              >
                {d.weekday_name}
              </Text>
              <Text
                style={[
                  styles.dayDate,
                  { color: isWorking ? "#fff" : colors.onSurface },
                ]}
              >
                {new Date(d.date + "T00:00:00").getDate()}
              </Text>
              <Text
                style={[
                  styles.dayLabel,
                  { color: c.text },
                ]}
              >
                {c.label}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function LegendItem({ color, label, isLight }: { color: string; label: string; isLight?: boolean }) {
  return (
    <View style={styles.legendItem}>
      <View
        style={[
          styles.legendSwatch,
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
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
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
  daysGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 4,
  },
  dayCell: {
    flex: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    minHeight: 92,
    justifyContent: "space-between",
  },
  dayCellSoft: {
    backgroundColor: colors.surfaceTertiary,
  },
  dayName: { fontSize: 10, fontWeight: "700", letterSpacing: 0.5 },
  dayDate: { fontSize: 18, fontWeight: "700", marginTop: 2 },
  dayLabel: { fontSize: 11, fontWeight: "700", marginTop: 4 },
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
    gap: spacing.lg,
    marginTop: spacing.xl,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  legendSwatch: { width: 16, height: 16, borderRadius: 4 },
  legendText: { color: colors.onSurfaceTertiary, fontSize: 13 },
  footNote: {
    color: colors.onSurfaceTertiary,
    fontSize: 12,
    marginTop: spacing.lg,
    lineHeight: 18,
  },
});
