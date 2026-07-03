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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { LogoMarkCompact, BrandFooter } from "@/src/components/Brand";
import {
  ScheduleForm,
  ScheduleFormState,
  initialScheduleState,
  scheduleStateToPayload,
} from "@/src/components/ScheduleForm";
import { colors, spacing, radius } from "@/src/theme/colors";

export default function RegisterScreen() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [schedule, setSchedule] = useState<ScheduleFormState>(() =>
    initialScheduleState(),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

    let payload;
    try {
      payload = scheduleStateToPayload(schedule);
    } catch (e: any) {
      setError(e.message || "Please review your schedule setup");
      return;
    }

    setLoading(true);
    try {
      const res = await api.register({
        name: name.trim(),
        pin,
        is_admin: false,
        ...payload,
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
            Pick a unique 4-digit PIN and tell us how you work.
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

          <ScheduleForm value={schedule} onChange={setSchedule} />

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
