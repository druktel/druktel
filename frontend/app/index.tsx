import { useEffect } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { api } from "@/src/api/client";
import { storage } from "@/src/utils/storage";
import { colors } from "@/src/theme/colors";

const ACCESS_GRANTED_KEY = "access_granted";

export default function Index() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const granted = await storage.getItem<string>(ACCESS_GRANTED_KEY, "");
      if (!granted) {
        router.replace("/access");
        return;
      }
      const token = await api.getToken();
      if (!token) {
        router.replace("/login");
        return;
      }
      try {
        await api.me();
        router.replace("/(tabs)");
      } catch {
        await api.setToken(null);
        router.replace("/login");
      }
    })();
  }, [router]);

  return (
    <View style={styles.container} testID="splash-loading">
      <ActivityIndicator color={colors.brand} size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
});
