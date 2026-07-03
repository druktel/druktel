import { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { api, UserPublic, RosterResponse, DayEntry } from "@/src/api/client";
import { colors, spacing, radius } from "@/src/theme/colors";

const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function statusMeta(status: DayEntry["status"]) {
  switch (status) {
    case "regular":
      return { bg: colors.brand, text: "#fff", label: "8.5h" };
    case "short":
      return { bg: colors.warning, text: "#fff", label: "8h" };
    case "day_off":
      return { bg: colors.surfaceTertiary, text: colors.onSurfaceTertiary, label: "OFF" };
    case "non_working":
      return { bg: "transparent", text: colors.muted, label: "—" };
  }
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] || "") + (parts[1]?.[0] || "");
}

export default function AdminScreen() {
  const [users, setUsers] = useState<UserPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<UserPublic | null>(null);
  const [selectedRoster, setSelectedRoster] = useState<RosterResponse | null>(null);
  const [rosterLoading, setRosterLoading] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.adminUsers();
      setUsers(res.users);
    } catch (e: any) {
      setError(e.message || "Failed to load users");
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

  const openUser = async (u: UserPublic) => {
    setSelected(u);
    setSelectedRoster(null);
    setRosterLoading(true);
    try {
      const r = await api.adminRoster(u.id, 14);
      setSelectedRoster(r);
    } catch (e: any) {
      setError(e.message || "Failed to load roster");
    } finally {
      setRosterLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Team Admin</Text>
        <Text style={styles.subtitle}>{users.length} employee{users.length === 1 ? "" : "s"}</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={{ color: colors.error }}>{error}</Text>
        </View>
      ) : (
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
          {users.length === 0 && (
            <View style={styles.empty}>
              <Ionicons name="people-outline" size={48} color={colors.muted} />
              <Text style={styles.emptyText}>No employees yet</Text>
            </View>
          )}
          {users.map((u) => (
            <TouchableOpacity
              key={u.id}
              testID={`admin-user-${u.id}`}
              style={styles.userRow}
              onPress={() => openUser(u)}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initials(u.name).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.userName}>
                  {u.name}
                  {u.is_admin && <Text style={styles.adminTag}>  · ADMIN</Text>}
                </Text>
                <Text style={styles.userSub}>
                  Works {u.working_days.map((d) => WEEKDAY_NAMES[d]).join(", ")}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.muted} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <Modal
        visible={!!selected}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSelected(null)}
      >
        <SafeAreaView style={styles.modalRoot} edges={["top", "bottom"]}>
          <View style={styles.modalHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalTitle}>{selected?.name}</Text>
              <Text style={styles.modalSub}>Next 2 weeks</Text>
            </View>
            <TouchableOpacity
              testID="close-user-modal"
              onPress={() => setSelected(null)}
              style={styles.closeBtn}
            >
              <Ionicons name="close" size={22} color={colors.onSurface} />
            </TouchableOpacity>
          </View>
          {rosterLoading || !selectedRoster ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.brand} />
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.modalScroll}>
              {[0, 1].map((wIdx) => {
                const days = selectedRoster.days.slice(wIdx * 7, wIdx * 7 + 7);
                const total = days.reduce((s, d) => s + d.hours, 0);
                return (
                  <View key={wIdx} style={styles.weekCard}>
                    <View style={styles.weekHeader}>
                      <Text style={styles.weekTitle}>Week {wIdx + 1}</Text>
                      <Text style={styles.weekHours}>{total.toFixed(1)}h</Text>
                    </View>
                    <View style={styles.daysGrid}>
                      {days.map((d) => {
                        const m = statusMeta(d.status);
                        const isWorking = d.status === "regular" || d.status === "short";
                        return (
                          <View
                            key={d.date}
                            style={[
                              styles.dayCell,
                              {
                                backgroundColor: m.bg,
                                borderColor: d.is_today ? colors.onSurface : "transparent",
                                borderWidth: d.is_today ? 2 : 0,
                              },
                              !isWorking && { backgroundColor: colors.surfaceTertiary },
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
                            <Text style={[styles.dayLabel, { color: m.text }]}>
                              {m.label}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { padding: spacing.xl, paddingBottom: spacing.md },
  title: { fontSize: 26, fontWeight: "700", color: colors.onSurface },
  subtitle: { color: colors.onSurfaceTertiary, marginTop: 4 },
  scroll: { padding: spacing.xl, paddingTop: 0, paddingBottom: spacing.xxxl },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", padding: spacing.xxxl, gap: spacing.md },
  emptyText: { color: colors.onSurfaceTertiary },
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.onBrandTertiary, fontWeight: "700" },
  userName: { color: colors.onSurface, fontWeight: "700", fontSize: 15 },
  adminTag: { color: colors.brand, fontSize: 11, fontWeight: "700" },
  userSub: { color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 2 },
  modalRoot: { flex: 1, backgroundColor: colors.surface },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.xl,
    paddingBottom: spacing.md,
  },
  modalTitle: { fontSize: 22, fontWeight: "700", color: colors.onSurface },
  modalSub: { color: colors.onSurfaceTertiary, marginTop: 2 },
  closeBtn: {
    padding: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalScroll: { padding: spacing.xl, paddingTop: 0, paddingBottom: spacing.xxxl },
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
  weekTitle: { fontSize: 15, fontWeight: "700", color: colors.onSurface },
  weekHours: { color: colors.onSurfaceTertiary, fontWeight: "600" },
  daysGrid: { flexDirection: "row", justifyContent: "space-between", gap: 4 },
  dayCell: {
    flex: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    minHeight: 88,
    justifyContent: "space-between",
  },
  dayName: { fontSize: 10, fontWeight: "700", letterSpacing: 0.5 },
  dayDate: { fontSize: 17, fontWeight: "700", marginTop: 2 },
  dayLabel: { fontSize: 11, fontWeight: "700", marginTop: 4 },
});
