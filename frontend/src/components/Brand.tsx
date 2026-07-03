import { View, Text, StyleSheet } from "react-native";
import { colors, radius } from "@/src/theme/colors";

type Props = {
  size?: number;
  variant?: "brand" | "light";
};

/**
 * Custom "Profile" logo — a rounded brand-green badge with a bold white "P"
 * and a small orange accent dot representing the "today" highlight from the
 * roster grid.
 */
export function Logo({ size = 64, variant = "brand" }: Props) {
  const badge = variant === "brand" ? colors.brand : "#FFFFFF";
  const letter = variant === "brand" ? "#FFFFFF" : colors.brand;
  const accent = "#F97316";
  return (
    <View
      style={[
        styles.badge,
        {
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.28),
          backgroundColor: badge,
        },
      ]}
    >
      <Text
        style={[
          styles.letter,
          {
            fontSize: Math.round(size * 0.6),
            color: letter,
            lineHeight: Math.round(size * 0.72),
          },
        ]}
      >
        P
      </Text>
      <View
        style={[
          styles.accent,
          {
            width: Math.round(size * 0.18),
            height: Math.round(size * 0.18),
            borderRadius: Math.round(size * 0.09),
            backgroundColor: accent,
            top: Math.round(size * 0.14),
            right: Math.round(size * 0.14),
          },
        ]}
      />
    </View>
  );
}

/**
 * Small footer used across auth screens.
 */
export function BrandFooter({ light }: { light?: boolean } = {}) {
  return (
    <View style={styles.footer}>
      <Text style={[styles.footerText, light && styles.footerTextLight]}>
        Your only digital{"  "}
        <Text style={[styles.footerBold, light && styles.footerBoldLight]}>
          by Druktel
        </Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 4,
  },
  letter: {
    fontWeight: "800",
    letterSpacing: -1,
    textAlign: "center",
    includeFontPadding: false,
  },
  accent: {
    position: "absolute",
  },
  footer: {
    alignItems: "center",
    paddingVertical: 12,
  },
  footerText: {
    fontSize: 11,
    color: "#8A8A8A",
    letterSpacing: 0.6,
    fontWeight: "500",
  },
  footerTextLight: {
    color: "rgba(255,255,255,0.72)",
  },
  footerBold: {
    fontWeight: "800",
    color: "#425948",
    letterSpacing: 0.4,
  },
  footerBoldLight: {
    color: "#FFFFFF",
  },
});

// re-export radius/border tokens to keep imports tidy elsewhere
export { radius };
