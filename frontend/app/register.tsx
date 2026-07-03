import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { LogoMarkCompact, BrandFooter } from "@/src/components/Brand";
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

function formatISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function RegisterScreen() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [workingDays, setWorkingDays] = useState<number[]>([0, 1, 2, 3, 4]);
  const [dayOffDate, setDayOffDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return formatISO(d);
  });
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleDay = (i: number) => {
    setWorkingDays((wd) =>
      wd.includes(i) ? wd.filter((x) => x !== i) : [...wd, i].sort(),
    );
  };

  const submit = async () => {
    setError(null);
    if (name.trim().length < 2) {
      setError("Enter your full name");
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      setError("PIN must be exactly 4 digits");
      return;
    }
    if (workingDays.length === 0) {
      setError("Select at least one working day");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayOffDate)) {
      setError("Day-off date must be YYYY-MM-DD");
      return;
    }
    const dow = new Date(dayOffDate + "T00:00:00").getDay();
    // JS Sunday=0 .. Sat=6; convert to Mon=0..Sun=6
    const isoDow = (dow + 6) % 7;
    if (!workingDays.includes(isoDow)) {
      setError("Day-off must be one of your working days");
      return;
    }

    setLoading(true);
    try {
      const res = await api.register({
        name: name.trim(),
        pin,
        working_days: workingDays,
        initial_day_off_date: dayOffDate,
        is_admin: isAdmin,
      });
      await api.setToken(res.token);
      router.replace("/(tabs)");
    } catch (e: any) {
      setError(e.message || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <TouchableOpacity
            testID="back-to-login"
            onPress={() => router.back()}
            style={styles.backBtn}
          >
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>

          <View style={styles.brandRow}>
            <LogoMarkCompact />
          </View>

          <Text style={styles.h1}>Set up your roster</Text>
          <Text style={styles.subtitle}>
            Pick a unique 4-digit PIN, your working days, and an upcoming
            day-off. We&apos;ll calculate the rest.
          </Text>

          <Text style={styles.label}>Full name</Text>
          <TextInput
            testID="input-name"
            value={name}
            onChangeText={setName}
            placeholder="Jane Doe"
            placeholderTextColor={colors.muted}
            style={styles.input}
            autoCapitalize="words"
          />

          <Text style={styles.label}>4-digit PIN</Text>
          <TextInput
            testID="input-pin"
            value={pin}
            onChangeText={(t) => setPin(t.replace(/\D/g, "").slice(0, 4))}
            placeholder="0000"
            placeholderTextColor={colors.muted}
            style={styles.input}
            keyboardType="number-pad"
            maxLength={4}
            secureTextEntry
          />

          <Text style={styles.label}>Working days</Text>
          <View style={styles.daysRow}>
            {WEEKDAYS.map((w) => {
              const selected = workingDays.includes(w.i);
              return (
                <TouchableOpacity
                  key={w.i}
                  testID={`working-day-${w.i}`}
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

          <Text style={styles.label}>Upcoming day-off date</Text>
          <DatePickerField
            testID="input-dayoff"
            value={dayOffDate}
            onChange={setDayOffDate}
            minimumDate={new Date()}
            label="Pick your day-off"
          />
          <Text style={styles.help}>
            This is a day-off in your fortnight cycle. The day before it becomes
            your 8h short day; the roster rotates every fortnight.
          </Text>

          <View style={styles.adminRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.adminLabel}>Admin account</Text>
              <Text style={styles.help}>
                Enable to view all team rosters.
              </Text>
            </View>
            <Switch
              testID="switch-admin"
              value={isAdmin}
              onValueChange={setIsAdmin}
              trackColor={{ false: colors.border, true: colors.brand }}
              thumbColor="#fff"
            />
          </View>

          {error && (
            <Text style={styles.error} testID="register-error">
              {error}
            </Text>
          )}

          <TouchableOpacity
            testID="register-submit"
            style={[styles.cta, loading && { opacity: 0.6 }]}
            onPress={submit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.ctaText}>Create account</Text>
            )}
          </TouchableOpacity>
          <BrandFooter />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  scroll: { padding: spacing.xl, paddingBottom: spacing.xxxl },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  backText: { color: colors.onSurface, fontSize: 15 },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  brandName: {
    fontSize: 24,
    fontWeight: "800",
    color: colors.onSurface,
    letterSpacing: -0.5,
  },
  h1: {
    fontSize: 28,
    fontWeight: "700",
    color: colors.onSurface,
    marginBottom: spacing.sm,
  },
  subtitle: {
    color: colors.onSurfaceTertiary,
    fontSize: 14,
    marginBottom: spacing.xl,
    lineHeight: 20,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.onSurfaceTertiary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 16,
    color: colors.onSurface,
  },
  daysRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  dayChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
    minWidth: 56,
    alignItems: "center",
  },
  dayChipActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  dayChipText: { color: colors.onSurface, fontWeight: "600" },
  dayChipTextActive: { color: "#fff" },
  help: {
    color: colors.onSurfaceTertiary,
    fontSize: 12,
    marginTop: spacing.sm,
    lineHeight: 18,
  },
  adminRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.xl,
    padding: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  adminLabel: {
    color: colors.onSurface,
    fontSize: 15,
    fontWeight: "600",
  },
  error: {
    color: colors.error,
    marginTop: spacing.lg,
    fontSize: 14,
  },
  cta: {
    marginTop: spacing.xl,
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: "center",
  },
  ctaText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
