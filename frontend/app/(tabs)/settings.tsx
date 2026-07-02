import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api, UserPublic } from "@/src/api/client";
import { DatePickerField } from "@/src/components/DatePickerField";
import { colors, spacing, radius } from "@/src/theme/colors";

const WEEKDAYS = [
  { i: 0, name: "Mon" },
  { i: 1, name: "Tue" },
  { i: 2, name: "Wed" },
  { i: 3, name: "Thu" },
  { i: 4, name: "Fri" },
  { i: 5, name: "Sat" },
  { i: 6, name: "Sun" },
];

export default function SettingsScreen() {
  const [user, setUser] = useState<UserPublic | null>(null);
  const [workingDays, setWorkingDays] = useState<number[]>([]);
  const [dayOffDate, setDayOffDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const me = await api.me();
        setUser(me);
        setWorkingDays(me.working_days);
        setDayOffDate(me.initial_day_off_date);
      } catch (e: any) {
        setMsg({ type: "err", text: e.message || "Failed to load" });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const toggleDay = (i: number) => {
    setWorkingDays((wd) =>
      wd.includes(i) ? wd.filter((x) => x !== i) : [...wd, i].sort(),
    );
  };

  const save = async () => {
    setMsg(null);
    if (workingDays.length === 0) {
      setMsg({ type: "err", text: "Select at least one working day" });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayOffDate)) {
      setMsg({ type: "err", text: "Date must be YYYY-MM-DD" });
      return;
    }
    const isoDow = (new Date(dayOffDate + "T00:00:00").getDay() + 6) % 7;
    if (!workingDays.includes(isoDow)) {
      setMsg({ type: "err", text: "Day-off must be one of your working days" });
      return;
    }
    setSaving(true);
    try {
      const updated = await api.updateMe({
        working_days: workingDays,
        initial_day_off_date: dayOffDate,
      });
      setUser(updated);
      setMsg({ type: "ok", text: "Roster settings updated" });
    } catch (e: any) {
      setMsg({ type: "err", text: e.message || "Save failed" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
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
              <Text style={styles.rowValue}>{user?.name}</Text>
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
              <Text style={styles.cardTitle}>Working days</Text>
            </View>
            <View style={styles.daysRow}>
              {WEEKDAYS.map((w) => {
                const selected = workingDays.includes(w.i);
                return (
                  <TouchableOpacity
                    key={w.i}
                    testID={`settings-day-${w.i}`}
                    onPress={() => toggleDay(w.i)}
                    style={[styles.dayChip, selected && styles.dayChipActive]}
                  >
                    <Text
                      style={[
                        styles.dayChipText,
                        selected && styles.dayChipTextActive,
                      ]}
                    >
                      {w.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name="sunny-outline" size={18} color={colors.brand} />
              <Text style={styles.cardTitle}>Upcoming day-off (anchor)</Text>
            </View>
            <DatePickerField
              testID="settings-dayoff"
              value={dayOffDate}
              onChange={setDayOffDate}
              label="Pick your day-off"
            />
            <Text style={styles.help}>
              This date must be one of your working days. The 8.5h short day and
              full roster rotate from here.
            </Text>
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
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  scroll: { padding: spacing.xl, paddingBottom: spacing.xxxl },
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
  rowValue: { color: colors.onSurface, fontWeight: "600" },
  badge: {
    backgroundColor: colors.brandTertiary,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  badgeText: { color: colors.onBrandTertiary, fontSize: 11, fontWeight: "700" },
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
  dayChipText: { color: colors.onSurface, fontWeight: "600" },
  dayChipTextActive: { color: "#fff" },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 16,
    color: colors.onSurface,
  },
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
});
