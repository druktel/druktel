import { View, Text, StyleSheet } from "react-native";
import { colors, radius } from "@/src/theme/colors";
import type { EmploymentType } from "@/src/api/client";

type Size = "sm" | "md";

export function FTPTBadge({
  type,
  size = "sm",
  testID,
}: {
  type?: EmploymentType | string | null;
  size?: Size;
  testID?: string;
}) {
  const label = type === "PT" ? "PT" : "FT";
  const isPT = label === "PT";
  const bg = isPT ? "#EDE7FA" : "#DCEBE0";
  const fg = isPT ? "#6E3EC5" : "#2E5138";

  const style = size === "md" ? styles.badgeMd : styles.badgeSm;
  const textStyle = size === "md" ? styles.textMd : styles.textSm;

  return (
    <View
      style={[style, { backgroundColor: bg, borderColor: fg + "33" }]}
      testID={testID || `ftpt-badge-${label}`}
    >
      <Text style={[textStyle, { color: fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badgeSm: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  badgeMd: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  textSm: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  textMd: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
});
