import { View, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { LogoMarkCompact } from "@/src/components/Brand";
import { api } from "@/src/api/client";
import { colors, spacing } from "@/src/theme/colors";

/**
 * Sticky app header used on every logged-in tab. Shows the Profile logo on
 * the left and a logout icon anchored to the right. Sits ABOVE the ScrollView
 * so it does not scroll away with content.
 */
export function AppHeader({ showLogout = true }: { showLogout?: boolean } = {}) {
  const router = useRouter();

  const onLogout = async () => {
    try {
      await api.logout();
    } catch {
      // Ignore network errors — clear token anyway.
    }
    await api.setToken(null);
    router.replace("/login");
  };

  return (
    <View style={styles.header} testID="app-header">
      <View style={styles.logoWrap}>
        <LogoMarkCompact />
      </View>
      {showLogout && (
        <TouchableOpacity
          testID="logout-btn"
          onPress={onLogout}
          style={styles.logoutBtn}
          hitSlop={8}
        >
          <Ionicons
            name="log-out-outline"
            size={22}
            color={colors.onSurface}
          />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  logoWrap: {
    flexShrink: 1,
  },
  logoutBtn: {
    padding: 8,
    borderRadius: 20,
    marginLeft: spacing.md,
  },
});
