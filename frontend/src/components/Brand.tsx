import { View, Text, StyleSheet } from "react-native";
import { colors, radius } from "@/src/theme/colors";

/**
 * Just the badge icon — a rounded brand-green square with a bold white "P"
 * and a small orange accent dot.
 */
export function Logo({ size = 64, variant = "brand" }: { size?: number; variant?: "brand" | "light" }) {
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
 * Full logo mark used on auth screens — badge stacked above the "Profile"
 * wordmark and the "Your only digital by Druktel" tagline.
 */
export function LogoMarkFull({ badgeSize = 72 }: { badgeSize?: number } = {}) {
  return (
    <View style={styles.markFull}>
      <Logo size={badgeSize} />
      <Text style={styles.brandFull}>Profile</Text>
      <Text style={styles.taglineFull}>
        Your only digital{"  "}
        <Text style={styles.taglineFullBold}>by Druktel</Text>
      </Text>
    </View>
  );
}

/**
 * Compact horizontal logo mark used in every in-app screen header.
 * Badge on the left, "Profile" wordmark + tagline stacked to the right.
 */
export function LogoMarkCompact() {
  return (
    <View style={styles.markCompact}>
      <Logo size={34} />
      <View style={styles.compactText}>
        <Text style={styles.brandCompact}>Profile</Text>
        <Text style={styles.taglineCompact}>
          Your only digital{" "}
          <Text style={styles.taglineCompactBold}>by Druktel</Text>
        </Text>
      </View>
    </View>
  );
}

/**
 * Small footer used across screens. Text-only (no badge).
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

  markFull: {
    alignItems: "center",
    gap: 10,
  },
  brandFull: {
    fontSize: 32,
    fontWeight: "800",
    color: colors.onSurface,
    letterSpacing: -0.5,
  },
  taglineFull: {
    fontSize: 11,
    color: colors.muted,
    letterSpacing: 0.8,
    fontWeight: "500",
  },
  taglineFullBold: {
    color: colors.onSurface,
    fontWeight: "800",
    letterSpacing: 0.4,
  },

  markCompact: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  compactText: { flexShrink: 1 },
  brandCompact: {
    fontSize: 17,
    fontWeight: "800",
    color: colors.onSurface,
    letterSpacing: -0.3,
    lineHeight: 20,
  },
  taglineCompact: {
    fontSize: 9,
    color: colors.muted,
    letterSpacing: 0.5,
    fontWeight: "500",
    marginTop: 1,
  },
  taglineCompactBold: {
    color: colors.brand,
    fontWeight: "800",
    letterSpacing: 0.3,
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
  footerTextLight: { color: "rgba(255,255,255,0.72)" },
  footerBold: {
    fontWeight: "800",
    color: "#425948",
    letterSpacing: 0.4,
  },
  footerBoldLight: { color: "#FFFFFF" },
});

export { radius };
