import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { api, UserPublic, Leave } from "@/src/api/client";
import { BrandFooter } from "@/src/components/Brand";
import { AppHeader } from "@/src/components/AppHeader";
import { DatePickerField } from "@/src/components/DatePickerField";
import { FTPTBadge } from "@/src/components/FTPTBadge";
import {
  ScheduleForm,
  ScheduleFormState,
  scheduleStateToPayload,
  userToScheduleState,
} from "@/src/components/ScheduleForm";
import { colors, spacing, radius } from "@/src/theme/colors";

export default function SettingsScreen() {
  const [user, setUser] = useState<UserPublic | null>(null);
  const [schedule, setSchedule] = useState<ScheduleFormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [newLeaveDate, setNewLeaveDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  });
  const [newLeaveNote, setNewLeaveNote] = useState("");
  const [addingLeave, setAddingLeave] = useState(false);
  const [leaveMsg, setLeaveMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const loadLeaves = useCallback(async () => {
    try {
      const res = await api.listLeaves();
      setLeaves(res.leaves);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const me = await api.me();
        setUser(me);
        setSchedule(userToScheduleState(me));
      } catch (e: any) {
        setMsg({ type: "err", text: e.message || "Failed to load" });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadLeaves();
    }, [loadLeaves]),
  );

  const addLeave = async () => {
    setLeaveMsg(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newLeaveDate)) {
      setLeaveMsg({ type: "err", text: "Pick a valid date" });
      return;
    }
    setAddingLeave(true);
    try {
      await api.addLeave(newLeaveDate, newLeaveNote.trim() || undefined);
      setNewLeaveNote("");
      setLeaveMsg({ type: "ok", text: "Leave day added" });
      await loadLeaves();
    } catch (e: any) {
      setLeaveMsg({ type: "err", text: e.message || "Failed to add" });
    } finally {
      setAddingLeave(false);
    }
  };

  const removeLeave = async (id: string) => {
    setLeaveMsg(null);
    try {
      await api.deleteLeave(id);
      await loadLeaves();
    } catch (e: any) {
      setLeaveMsg({ type: "err", text: e.message || "Failed to remove" });
    }
  };

  const save = async () => {
    setMsg(null);
    if (!schedule) return;
    let payload;
    try {
      payload = scheduleStateToPayload(schedule);
    } catch (e: any) {
      setMsg({ type: "err", text: e.message || "Please review your schedule" });
      return;
    }
    setSaving(true);
    try {
      const updated = await api.updateMe(payload);
      setUser(updated);
      setSchedule(userToScheduleState(updated));
      setMsg({ type: "ok", text: "Roster settings updated" });
    } catch (e: any) {
      setMsg({ type: "err", text: e.message || "Save failed" });
    } finally {
      setSaving(false);
    }
  };

  if (loading || !schedule) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <AppHeader />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Settings</Text>
          <Text style={styles.subtitle}>Edit your roster preferences.</Text>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name="person-outline" size={18} color={colors.brand} />
              <Text style={styles.cardTitle}>Profile</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Name</Text>
              <View style={styles.rowValueGroup}>
                <FTPTBadge type={user?.employment_type} size="sm" />
                <Text style={styles.rowValue}>{user?.name}</Text>
              </View>
            </View>
            {user?.is_admin && (
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Role</Text>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>ADMIN</Text>
                </View>
              </View>
            )}
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name="calendar-outline" size={18} color={colors.brand} />
              <Text style={styles.cardTitle}>Work schedule</Text>
            </View>
            <ScheduleForm value={schedule} onChange={setSchedule} />
          </View>

          {msg && (
            <Text
              testID="settings-message"
              style={[
                styles.msg,
                msg.type === "ok" ? styles.msgOk : styles.msgErr,
              ]}
            >
              {msg.text}
            </Text>
          )}

          <TouchableOpacity
            testID="settings-save"
            onPress={save}
            style={[styles.cta, saving && { opacity: 0.6 }]}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.ctaText}>Save changes</Text>
            )}
          </TouchableOpacity>

          <View style={[styles.card, { marginTop: spacing.xl }]}>
            <View style={styles.cardHeader}>
              <Ionicons name="airplane-outline" size={18} color="#7C3AED" />
              <Text style={styles.cardTitle}>Personal leave days</Text>
            </View>
            <Text style={[styles.help, { marginTop: 0, marginBottom: spacing.md }]}>
              Mark days as personal leave. They override the auto-computed
              roster and show as 0h.
            </Text>

            <Text style={styles.smallLabel}>Date</Text>
            <DatePickerField
              testID="new-leave-date"
              value={newLeaveDate}
              onChange={setNewLeaveDate}
              label="Pick a leave date"
            />

            <Text style={[styles.smallLabel, { marginTop: spacing.md }]}>
              Note (optional)
            </Text>
            <TextInput
              testID="new-leave-note"
              value={newLeaveNote}
              onChangeText={setNewLeaveNote}
              placeholder="e.g., Annual leave, sick day"
              placeholderTextColor={colors.muted}
              style={styles.leaveInput}
              maxLength={80}
            />

            {leaveMsg && (
              <Text
                testID="leave-message"
                style={[
                  styles.msg,
                  leaveMsg.type === "ok" ? styles.msgOk : styles.msgErr,
                ]}
              >
                {leaveMsg.text}
              </Text>
            )}

            <TouchableOpacity
              testID="add-leave-btn"
              onPress={addLeave}
              style={[styles.addLeaveBtn, addingLeave && { opacity: 0.6 }]}
              disabled={addingLeave}
            >
              {addingLeave ? (
                <ActivityIndicator color="#7C3AED" />
              ) : (
                <>
                  <Ionicons name="add" size={18} color="#7C3AED" />
                  <Text style={styles.addLeaveText}>Add leave day</Text>
                </>
              )}
            </TouchableOpacity>

            {leaves.length > 0 && (
              <View style={styles.leaveList}>
                {leaves.map((l) => (
                  <View key={l.id} style={styles.leaveRow} testID={`leave-row-${l.date}`}>
                    <View style={styles.leaveDot} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.leaveDate}>
                        {new Date(l.date + "T00:00:00").toLocaleDateString(undefined, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </Text>
                      {l.note ? (
                        <Text style={styles.leaveNote}>{l.note}</Text>
                      ) : null}
                    </View>
                    <TouchableOpacity
                      testID={`delete-leave-${l.date}`}
                      onPress={() => removeLeave(l.id)}
                      style={styles.leaveDeleteBtn}
                    >
                      <Ionicons name="trash-outline" size={18} color={colors.error} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
            {leaves.length === 0 && (
              <Text style={[styles.help, { marginTop: spacing.md }]}>
                No personal leave days scheduled.
              </Text>
            )}
          </View>
          <BrandFooter />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  scroll: { padding: spacing.xl, paddingBottom: spacing.xxxl },
  brandBar: { marginBottom: spacing.md },
  title: { fontSize: 26, fontWeight: "700", color: colors.onSurface },
  subtitle: { color: colors.onSurfaceTertiary, marginTop: 4, marginBottom: spacing.xl },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  cardTitle: { fontSize: 15, fontWeight: "700", color: colors.onSurface },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  rowLabel: { color: colors.onSurfaceTertiary },
  rowValueGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  rowValue: { color: colors.onSurface, fontWeight: "600" },
  badge: {
    backgroundColor: colors.brandTertiary,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  badgeText: { color: colors.onBrandTertiary, fontSize: 11, fontWeight: "700" },
  help: { color: colors.onSurfaceTertiary, fontSize: 12, marginTop: spacing.sm, lineHeight: 18 },
  msg: { marginTop: spacing.lg, fontSize: 14 },
  msgOk: { color: colors.success },
  msgErr: { color: colors.error },
  cta: {
    marginTop: spacing.lg,
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: "center",
  },
  ctaText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  smallLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.onSurfaceTertiary,
    marginBottom: spacing.sm,
  },
  leaveInput: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 15,
    color: colors.onSurface,
  },
  addLeaveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#7C3AED",
    backgroundColor: "#F5F0FF",
  },
  addLeaveText: { color: "#7C3AED", fontWeight: "700" },
  leaveList: { marginTop: spacing.md, gap: spacing.sm },
  leaveRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  leaveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#7C3AED",
  },
  leaveDate: { color: colors.onSurface, fontWeight: "600", fontSize: 14 },
  leaveNote: { color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 2 },
  leaveDeleteBtn: { padding: spacing.sm },
});
