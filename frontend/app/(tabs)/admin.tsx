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
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { api, UserPublic, RosterResponse, DayEntry, AccessCode } from "@/src/api/client";
import { LogoMarkCompact } from "@/src/components/Brand";
import { FTPTBadge } from "@/src/components/FTPTBadge";
import { colors, spacing, radius } from "@/src/theme/colors";

const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function statusMeta(d: DayEntry) {
  switch (d.status) {
    case "regular":
      return { bg: colors.brand, text: "#fff", label: `${d.hours.toFixed(1)}h` };
    case "short":
      return { bg: colors.warning, text: "#fff", label: `${d.hours.toFixed(1)}h` };
    case "day_off":
      return { bg: colors.surfaceTertiary, text: colors.onSurfaceTertiary, label: "OFF" };
    case "leave":
      return { bg: "#7C3AED", text: "#fff", label: "LEAVE" };
    case "non_working":
      return { bg: "transparent", text: colors.muted, label: "—" };
  }
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] || "") + (parts[1]?.[0] || "");
}

export default function AdminScreen() {
  const [tab, setTab] = useState<"users" | "codes">("users");
  const [users, setUsers] = useState<UserPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<UserPublic | null>(null);
  const [selectedRoster, setSelectedRoster] = useState<RosterResponse | null>(null);
  const [rosterLoading, setRosterLoading] = useState(false);

  // Access codes state
  const [codes, setCodes] = useState<AccessCode[]>([]);
  const [newCode, setNewCode] = useState("");
  const [newCodeNote, setNewCodeNote] = useState("");
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeMsg, setCodeMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const loadCodes = useCallback(async () => {
    try {
      const res = await api.adminListAccessCodes();
      setCodes(res.codes);
    } catch (e: any) {
      setCodeMsg({ type: "err", text: e.message || "Failed to load codes" });
    }
  }, []);

  const addCode = async () => {
    setCodeMsg(null);
    if (!/^\d{4}$/.test(newCode)) {
      setCodeMsg({ type: "err", text: "Code must be exactly 4 digits" });
      return;
    }
    setCodeBusy(true);
    try {
      await api.adminCreateAccessCode(newCode, newCodeNote.trim() || undefined);
      setNewCode("");
      setNewCodeNote("");
      setCodeMsg({ type: "ok", text: "Access code created" });
      await loadCodes();
    } catch (e: any) {
      setCodeMsg({ type: "err", text: e.message || "Failed to create" });
    } finally {
      setCodeBusy(false);
    }
  };

  const removeCode = async (id: string) => {
    setCodeMsg(null);
    try {
      await api.adminDeleteAccessCode(id);
      setCodeMsg({ type: "ok", text: "Access code deleted" });
      await loadCodes();
    } catch (e: any) {
      setCodeMsg({ type: "err", text: e.message || "Failed to delete" });
    }
  };

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
      loadCodes();
    }, [load, loadCodes]),
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
        <View style={styles.brandBar}>
          <LogoMarkCompact />
        </View>
        <Text style={styles.title}>Team Admin</Text>
        <Text style={styles.subtitle}>
          {tab === "users"
            ? `${users.length} employee${users.length === 1 ? "" : "s"}`
            : `${codes.length} active code${codes.length === 1 ? "" : "s"}`}
        </Text>

        <View style={styles.segment}>
          <TouchableOpacity
            testID="admin-seg-users"
            style={[styles.segBtn, tab === "users" && styles.segBtnActive]}
            onPress={() => setTab("users")}
          >
            <Ionicons
              name="people-outline"
              size={16}
              color={tab === "users" ? "#fff" : colors.onSurface}
            />
            <Text style={[styles.segText, tab === "users" && styles.segTextActive]}>
              Users
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="admin-seg-codes"
            style={[styles.segBtn, tab === "codes" && styles.segBtnActive]}
            onPress={() => setTab("codes")}
          >
            <Ionicons
              name="key-outline"
              size={16}
              color={tab === "codes" ? "#fff" : colors.onSurface}
            />
            <Text style={[styles.segText, tab === "codes" && styles.segTextActive]}>
              Access codes
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {tab === "users" ? (
        loading ? (
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
                <View style={styles.userNameRow}>
                  <Text style={styles.userName} numberOfLines={1}>
                    {u.name}
                    {u.is_admin && <Text style={styles.adminTag}>  · ADMIN</Text>}
                  </Text>
                  <FTPTBadge type={u.employment_type} size="sm" />
                </View>
                <Text style={styles.userSub}>
                  Works {u.working_days.map((d) => WEEKDAY_NAMES[d]).join(", ")}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.muted} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      )
      ) : (
        // ACCESS CODES TAB
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.codeCard}>
            <Text style={styles.codeCardTitle}>Create new access code</Text>
            <Text style={styles.codeHelp}>
              Share the 4-digit code with new employees so they can unlock the
              app and register their profile.
            </Text>
            <Text style={styles.smallLabel}>4-digit code</Text>
            <TextInput
              testID="new-access-code"
              value={newCode}
              onChangeText={(t) => setNewCode(t.replace(/\D/g, "").slice(0, 4))}
              placeholder="0000"
              placeholderTextColor={colors.muted}
              style={styles.codeInput}
              keyboardType="number-pad"
              maxLength={4}
            />
            <Text style={[styles.smallLabel, { marginTop: spacing.md }]}>
              Note (optional)
            </Text>
            <TextInput
              testID="new-access-note"
              value={newCodeNote}
              onChangeText={setNewCodeNote}
              placeholder="e.g., Warehouse team"
              placeholderTextColor={colors.muted}
              style={styles.codeInput}
              maxLength={80}
            />

            {codeMsg && (
              <Text
                testID="code-message"
                style={[
                  styles.codeMsg,
                  codeMsg.type === "ok" ? styles.codeMsgOk : styles.codeMsgErr,
                ]}
              >
                {codeMsg.text}
              </Text>
            )}

            <TouchableOpacity
              testID="add-access-code-btn"
              onPress={addCode}
              style={[styles.codeCta, codeBusy && { opacity: 0.6 }]}
              disabled={codeBusy}
            >
              {codeBusy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="add" size={18} color="#fff" />
                  <Text style={styles.codeCtaText}>Create code</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          <Text style={styles.sectionHeader}>Active codes</Text>
          {codes.length === 0 && (
            <View style={styles.empty}>
              <Ionicons name="key-outline" size={40} color={colors.muted} />
              <Text style={styles.emptyText}>No access codes yet</Text>
            </View>
          )}
          {codes.map((c) => (
            <View key={c.id} style={styles.codeRow} testID={`access-code-${c.code}`}>
              <View style={styles.codeBadge}>
                <Text style={styles.codeBadgeText}>{c.code}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.codeNote}>{c.note || "(no note)"}</Text>
                <Text style={styles.codeMeta}>
                  Created {new Date(c.created_at).toLocaleDateString()}
                </Text>
              </View>
              <TouchableOpacity
                testID={`delete-access-code-${c.code}`}
                onPress={() => removeCode(c.id)}
                style={styles.codeDelete}
              >
                <Ionicons name="trash-outline" size={18} color={colors.error} />
              </TouchableOpacity>
            </View>
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
              <View style={styles.modalTitleRow}>
                <Text style={styles.modalTitle}>{selected?.name}</Text>
                {selected?.employment_type && (
                  <FTPTBadge type={selected.employment_type} size="md" />
                )}
              </View>
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
                        const m = statusMeta(d);
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
  brandBar: { marginBottom: spacing.md },
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
  userName: { color: colors.onSurface, fontWeight: "700", fontSize: 15, flexShrink: 1 },
  userNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
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
  modalTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
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
  segment: {
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
  segBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  segBtnActive: { backgroundColor: colors.brand },
  segText: { color: colors.onSurface, fontWeight: "600", fontSize: 13 },
  segTextActive: { color: "#fff" },
  codeCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  codeCardTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.onSurface,
    marginBottom: spacing.sm,
  },
  codeHelp: {
    color: colors.onSurfaceTertiary,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: spacing.md,
  },
  smallLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.onSurfaceTertiary,
    marginBottom: spacing.sm,
  },
  codeInput: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 15,
    color: colors.onSurface,
  },
  codeMsg: { marginTop: spacing.md, fontSize: 13 },
  codeMsgOk: { color: colors.success },
  codeMsgErr: { color: colors.error },
  codeCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  codeCtaText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  sectionHeader: {
    color: colors.onSurfaceTertiary,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
  },
  codeRow: {
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
  codeBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    backgroundColor: colors.brandTertiary,
    borderRadius: radius.sm,
  },
  codeBadgeText: {
    color: colors.onBrandTertiary,
    fontFamily: "monospace",
    fontWeight: "800",
    fontSize: 15,
    letterSpacing: 2,
  },
  codeNote: { color: colors.onSurface, fontWeight: "600", fontSize: 14 },
  codeMeta: { color: colors.onSurfaceTertiary, fontSize: 11, marginTop: 2 },
  codeDelete: { padding: spacing.sm },
});
