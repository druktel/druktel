import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { api, RosterResponse, UserPublic } from "@/src/api/client";
import { LogoMarkCompact } from "@/src/components/Brand";
import { FTPTBadge } from "@/src/components/FTPTBadge";
import { colors, spacing, radius } from "@/src/theme/colors";

type TodayInfo = {
  date: string;
  weekday_name: string;
  status: "regular" | "short" | "day_off" | "non_working" | "leave";
  hours: number;
  label: string;
  public_holiday?: string | null;
  school_holiday?: string | null;
  leave_note?: string | null;
};

const DAY_OFF_IMG =
  "https://images.unsplash.com/photo-1777460978703-32d290b8f9e3?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2NzV8MHwxfHNlYXJjaHwxfHxjYWxtJTIwbWluaW1hbCUyMG5hdHVyZSUyMHdvcmtzcGFjZXxlbnwwfHx8fDE3ODI5NzI2OTd8MA&ixlib=rb-4.1.0&q=85";

function formatDateLong(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function statusMeta(status: TodayInfo["status"]) {
  switch (status) {
    case "regular":
      return { title: "Regular shift", tint: colors.brandTertiary, accent: colors.brand };
    case "short":
      return { title: "Short day", tint: colors.warningTint, accent: colors.warning };
    case "day_off":
      return { title: "Day off", tint: colors.surfaceTertiary, accent: colors.muted };
    case "leave":
      return { title: "Personal leave", tint: "#F5F0FF", accent: "#7C3AED" };
    case "non_working":
      return { title: "Weekend", tint: colors.surfaceTertiary, accent: colors.muted };
  }
}

export default function TodayScreen() {
  const router = useRouter();
  const [user, setUser] = useState<UserPublic | null>(null);
  const [today, setToday] = useState<TodayInfo | null>(null);
  const [roster, setRoster] = useState<RosterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [me, t, r] = await Promise.all([
        api.me(),
        api.today(),
        api.myRoster(undefined, 14),
      ]);
      setUser(me);
      setToday(t);
      setRoster(r);
    } catch (e: any) {
      setError(e.message || "Failed to load");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    load();
  }, [load]);

  const onLogout = async () => {
    try {
      await api.logout();
    } catch {}
    await api.setToken(null);
    router.replace("/login");
  };

  if (loading) {
    return (
      <View style={styles.center} testID="today-loading">
        <ActivityIndicator color={colors.brand} size="large" />
      </View>
    );
  }

  const meta = today ? statusMeta(today.status) : null;
  const upcoming = roster?.days.filter((d) => !d.is_today && new Date(d.date) >= new Date(today?.date || "")).slice(0, 5) || [];

  const fortnightHours = roster?.days.reduce((sum, d) => sum + d.hours, 0) || 0;

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={colors.brand}
          />
        }
      >
        <View style={styles.brandBar}>
          <LogoMarkCompact />
        </View>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <View style={styles.helloRow}>
              <Text style={styles.hello}>Hi, {user?.name.split(" ")[0]}</Text>
              {user?.employment_type && (
                <FTPTBadge type={user.employment_type} size="md" testID="today-badge" />
              )}
            </View>
            <Text style={styles.headerSub}>
              {today ? formatDateLong(today.date) : ""}
            </Text>
          </View>
          <TouchableOpacity
            testID="logout-btn"
            onPress={onLogout}
            style={styles.logoutBtn}
          >
            <Ionicons name="log-out-outline" size={22} color={colors.onSurface} />
          </TouchableOpacity>
        </View>

        {error && (
          <View style={styles.errorBox} testID="today-error">
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {today && meta && (
          <View
            style={[styles.heroCard, { backgroundColor: meta.tint }]}
            testID="today-card"
          >
            {today.status === "day_off" && (
              <Image source={{ uri: DAY_OFF_IMG }} style={styles.dayOffImg} />
            )}
            <View style={styles.heroContent}>
              <Text style={[styles.heroKicker, { color: meta.accent }]}>
                TODAY · {today.weekday_name.toUpperCase()}
              </Text>
              <Text style={styles.heroTitle} testID="today-status">
                {meta.title}
              </Text>
              {today.status !== "day_off" && today.status !== "non_working" && today.status !== "leave" ? (
                <>
                  <Text style={styles.heroHours} testID="today-hours">
                    {today.hours.toFixed(1)}h
                  </Text>
                  <Text style={styles.heroSub}>
                    {user?.has_lunch_break === false
                      ? "No lunch break — paid hours shown"
                      : "30 min unpaid lunch already excluded"}
                  </Text>
                </>
              ) : today.status === "leave" ? (
                <>
                  <Text style={styles.heroSub}>
                    You&apos;re off — {today.leave_note || "personal leave"}.
                  </Text>
                </>
              ) : (
                <Text style={styles.heroSub}>Enjoy your rest.</Text>
              )}
            </View>
          </View>
        )}

        <View style={styles.summaryRow}>
          <View style={styles.summaryCard} testID="fortnight-hours-card">
            <Text style={styles.summaryLabel}>Fortnight hours</Text>
            <Text style={styles.summaryValue}>{fortnightHours.toFixed(1)}h</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Working days / wk</Text>
            <Text style={styles.summaryValue}>{user?.working_days.length ?? 0}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Coming up</Text>
        <View style={styles.upcomingList}>
          {upcoming.length === 0 && (
            <Text style={styles.help}>Check the Roster tab for your full fortnight.</Text>
          )}
          {upcoming.map((d) => {
            const m = statusMeta(d.status);
            return (
              <View key={d.date} style={styles.upcomingRow} testID={`upcoming-${d.date}`}>
                <View style={[styles.upcomingDot, { backgroundColor: m.accent }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.upcomingDate}>
                    {d.weekday_name}, {new Date(d.date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </Text>
                  <Text style={styles.upcomingLabel}>{d.label}</Text>
                </View>
                <Text style={styles.upcomingHours}>
                  {d.status === "day_off" || d.status === "non_working" || d.status === "leave" ? "—" : `${d.hours.toFixed(1)}h`}
                </Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  scroll: { padding: spacing.xl, paddingBottom: spacing.xxxl },
  brandBar: {
    marginBottom: spacing.lg,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.xl,
  },
  hello: { fontSize: 26, fontWeight: "700", color: colors.onSurface },
  helloRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    flexWrap: "wrap",
  },
  headerSub: { color: colors.onSurfaceTertiary, marginTop: 2 },
  logoutBtn: {
    padding: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  errorBox: {
    padding: spacing.md,
    backgroundColor: "#FFECEC",
    borderRadius: radius.md,
    marginBottom: spacing.lg,
  },
  errorText: { color: colors.error },
  heroCard: {
    borderRadius: radius.lg,
    padding: spacing.xl,
    minHeight: 180,
    overflow: "hidden",
    position: "relative",
  },
  dayOffImg: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.25,
  },
  heroContent: {},
  heroKicker: { fontSize: 12, fontWeight: "700", letterSpacing: 1 },
  heroTitle: {
    fontSize: 28,
    fontWeight: "700",
    marginTop: spacing.sm,
    color: colors.onSurface,
  },
  heroHours: {
    fontSize: 48,
    fontWeight: "700",
    marginTop: spacing.md,
    color: colors.onSurface,
    letterSpacing: -1,
  },
  heroSub: { color: colors.onSurfaceTertiary, marginTop: 4 },
  summaryRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  summaryLabel: { color: colors.onSurfaceTertiary, fontSize: 12 },
  summaryValue: {
    color: colors.onSurface,
    fontSize: 22,
    fontWeight: "700",
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.onSurface,
    marginTop: spacing.xxl,
    marginBottom: spacing.md,
  },
  upcomingList: { gap: spacing.sm },
  upcomingRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  upcomingDot: { width: 10, height: 10, borderRadius: 5 },
  upcomingDate: { color: colors.onSurface, fontWeight: "600" },
  upcomingLabel: { color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 2 },
  upcomingHours: { color: colors.onSurface, fontWeight: "700" },
  help: { color: colors.onSurfaceTertiary, fontSize: 13 },
});
