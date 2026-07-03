import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, Link } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { api } from "@/src/api/client";
import { storage } from "@/src/utils/storage";
import { Logo, BrandFooter } from "@/src/components/Brand";
import { colors, spacing, radius } from "@/src/theme/colors";

const HERO =
  "https://images.unsplash.com/photo-1672152567948-0d3d10da0039?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2NzV8MHwxfHNlYXJjaHwxfHxtb2Rlcm4lMjBvZmZpY2UlMjBidWlsZGluZyUyMGV4dGVyaW9yJTIwbWluaW1hbHxlbnwwfHx8fDE3ODI5NzI2OTd8MA&ixlib=rb-4.1.0&q=85";

export default function LoginScreen() {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adminGate, setAdminGate] = useState(false);

  useEffect(() => {
    (async () => {
      const flag = await storage.getItem<string>("admin_gate", "");
      setAdminGate(!!flag);
    })();
  }, []);

  const onPress = async (n: string) => {
    if (loading) return;
    setError(null);
    if (n === "del") {
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (pin.length >= 4) return;
    const next = pin + n;
    setPin(next);
    if (next.length === 4) {
      submit(next);
    }
  };

  const submit = async (p: string) => {
    setLoading(true);
    try {
      const res = await api.login(p);
      await api.setToken(res.token);
      router.replace("/(tabs)");
    } catch (e: any) {
      setError(e.message || "Login failed");
      setPin("");
    } finally {
      setLoading(false);
    }
  };

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];

  return (
    <View style={styles.root} testID="login-screen">
      <View style={styles.heroWrap}>
        <Image source={{ uri: HERO }} style={styles.hero} />
        <LinearGradient
          colors={["rgba(0,0,0,0)", "rgba(26,26,26,0.85)"]}
          style={styles.scrim}
        />
        <SafeAreaView edges={["top"]} style={styles.heroContent}>
          <View style={styles.brandRow}>
            <Logo size={56} />
            <View>
              <Text style={styles.brand}>Profile</Text>
              <Text style={styles.tagline}>
                {adminGate ? "Admin sign-in — enter your PIN" : "Enter your 4-digit PIN"}
              </Text>
            </View>
          </View>
        </SafeAreaView>
      </View>

      <SafeAreaView edges={["bottom"]} style={styles.bottom}>
        <View style={styles.pinRow}>
          {[0, 1, 2, 3].map((i) => (
            <View
              key={i}
              testID={`pin-dot-${i}`}
              style={[styles.dot, i < pin.length && styles.dotActive]}
            />
          ))}
        </View>
        {error && (
          <Text style={styles.error} testID="login-error">
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
                testID={isDel ? "pin-key-del" : `pin-key-${k}`}
                style={styles.padKey}
                onPress={() => onPress(k)}
                disabled={loading}
              >
                {isDel ? (
                  <Ionicons
                    name="backspace-outline"
                    size={24}
                    color={colors.onSurface}
                  />
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
        {!adminGate ? (
          <Link href="/register" asChild>
            <TouchableOpacity testID="go-to-register" style={styles.registerLink}>
              <Text style={styles.registerText}>
                New here? <Text style={styles.registerBold}>Create account</Text>
              </Text>
            </TouchableOpacity>
          </Link>
        ) : (
          <Text testID="admin-only-notice" style={styles.adminNotice}>
            <Ionicons name="shield-checkmark-outline" size={13} color={colors.brand} />{" "}
            Admin-only access. Contact your team lead for a standard code.
          </Text>
        )}
        <TouchableOpacity
          testID="change-access-code"
          style={styles.changeAccessBtn}
          onPress={async () => {
            await storage.removeItem("access_granted");
            await storage.removeItem("admin_gate");
            router.replace("/access");
          }}
        >
          <Ionicons name="key-outline" size={14} color={colors.muted} />
          <Text style={styles.changeAccessText}>Change access code</Text>
        </TouchableOpacity>
        <BrandFooter />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  heroWrap: { height: 260, position: "relative" },
  hero: { width: "100%", height: "100%" },
  scrim: { ...StyleSheet.absoluteFillObject },
  heroContent: {
    ...StyleSheet.absoluteFillObject,
    padding: spacing.xl,
    justifyContent: "flex-end",
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  brand: {
    color: "#fff",
    fontSize: 32,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  tagline: { color: "rgba(255,255,255,0.85)", fontSize: 14, marginTop: 4 },
  bottom: {
    flex: 1,
    alignItems: "center",
    paddingTop: spacing.xl,
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
  registerLink: { marginTop: spacing.xl },
  registerText: { color: colors.onSurfaceTertiary, fontSize: 14 },
  registerBold: { color: colors.brand, fontWeight: "700" },
  adminNotice: {
    marginTop: spacing.xl,
    color: colors.onSurfaceTertiary,
    fontSize: 12,
    textAlign: "center",
    paddingHorizontal: spacing.lg,
    lineHeight: 18,
  },
  changeAccessBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: spacing.lg,
    padding: spacing.sm,
  },
  changeAccessText: { color: colors.muted, fontSize: 12 },
});
