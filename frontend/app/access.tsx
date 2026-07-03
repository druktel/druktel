import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { storage } from "@/src/utils/storage";
import { Logo, BrandFooter } from "@/src/components/Brand";
import { colors, spacing, radius } from "@/src/theme/colors";

const ACCESS_GRANTED_KEY = "access_granted";

export default function AccessGateScreen() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPress = async (n: string) => {
    if (loading) return;
    setError(null);
    if (n === "del") {
      setCode((p) => p.slice(0, -1));
      return;
    }
    if (code.length >= 4) return;
    const next = code + n;
    setCode(next);
    if (next.length === 4) submit(next);
  };

  const submit = async (c: string) => {
    setLoading(true);
    try {
      await api.verifyAccessCode(c);
      await storage.setItem(ACCESS_GRANTED_KEY, "1");
      router.replace("/login");
    } catch (e: any) {
      setError(e.message || "Invalid code");
      setCode("");
    } finally {
      setLoading(false);
    }
  };

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]} testID="access-gate">
      <View style={styles.header}>
        <Logo size={72} />
        <Text style={styles.brand}>Profile</Text>
        <Text style={styles.subtitle}>Enter the 4-digit access code</Text>
        <Text style={styles.hint}>
          Your administrator will share this with you to unlock the app.
        </Text>
      </View>

      <View style={styles.pinArea}>
        <View style={styles.pinRow}>
          {[0, 1, 2, 3].map((i) => (
            <View
              key={i}
              testID={`access-dot-${i}`}
              style={[styles.dot, i < code.length && styles.dotActive]}
            />
          ))}
        </View>
        {error && (
          <Text style={styles.error} testID="access-error">
            {error}
          </Text>
        )}
        <View style={styles.pad}>
          {keys.map((k, idx) => {
            if (k === "") return <View key={idx} style={styles.padKey} />;
            const isDel = k === "del";
            return (
              <TouchableOpacity
                key={idx}
                testID={isDel ? "access-key-del" : `access-key-${k}`}
                style={styles.padKey}
                onPress={() => onPress(k)}
                disabled={loading}
              >
                {isDel ? (
                  <Ionicons name="backspace-outline" size={24} color={colors.onSurface} />
                ) : (
                  <Text style={styles.padKeyText}>{k}</Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
        {loading && (
          <ActivityIndicator style={{ marginTop: spacing.sm }} color={colors.brand} />
        )}
      </View>

      <BrandFooter />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    alignItems: "center",
    paddingTop: spacing.xxl,
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  brand: {
    fontSize: 32,
    fontWeight: "800",
    color: colors.onSurface,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    color: colors.onSurface,
    fontWeight: "600",
    marginTop: spacing.sm,
  },
  hint: {
    fontSize: 13,
    color: colors.onSurfaceTertiary,
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: spacing.lg,
  },
  pinArea: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  pinRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.borderStrong,
  },
  dotActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  error: {
    color: colors.error,
    fontSize: 13,
    marginBottom: spacing.md,
    textAlign: "center",
  },
  pad: {
    width: "100%",
    maxWidth: 320,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: spacing.md,
  },
  padKey: {
    width: "30%",
    aspectRatio: 1.6,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  padKeyText: { fontSize: 26, fontWeight: "600", color: colors.onSurface },
});
