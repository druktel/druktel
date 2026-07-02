import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius } from "@/src/theme/colors";

type Props = {
  value: string;
  onChange: (iso: string) => void;
  minimumDate?: Date;
  maximumDate?: Date;
  testID?: string;
  label?: string;
};

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function formatDisplay(iso: string): string {
  try {
    const d = parseISO(iso);
    return d.toLocaleDateString(undefined, {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export function DatePickerField(props: Props) {
  if (Platform.OS === "web") {
    return <WebDateField {...props} />;
  }
  return <NativeDateField {...props} />;
}

// -------- Web: native HTML date input, styled to match --------
function WebDateField({ value, onChange, minimumDate, maximumDate, testID }: Props) {
  return (
    <View style={styles.field}>
      <Ionicons name="calendar-outline" size={18} color={colors.brand} />
      {/* @ts-expect-error web-only DOM element inside RN tree */}
      <input
        data-testid={testID || "date-picker-field"}
        type="date"
        value={value}
        min={minimumDate ? toISO(minimumDate) : undefined}
        max={maximumDate ? toISO(maximumDate) : undefined}
        onChange={(e: any) => onChange(e.target.value)}
        style={{
          flex: 1,
          border: "none",
          outline: "none",
          background: "transparent",
          fontSize: 15,
          fontFamily: "inherit",
          color: colors.onSurface,
          padding: 0,
        }}
      />
    </View>
  );
}

// -------- Native (iOS/Android) --------
function NativeDateField({
  value,
  onChange,
  minimumDate,
  maximumDate,
  testID,
  label,
}: Props) {
  const [open, setOpen] = useState(false);
  const [tempDate, setTempDate] = useState<Date>(() =>
    value ? parseISO(value) : new Date(),
  );

  // Lazy require so web bundle doesn't try to resolve native module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { default: DateTimePicker } = require("@react-native-community/datetimepicker");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Modal } = require("react-native");

  const openPicker = () => {
    setTempDate(value ? parseISO(value) : new Date());
    setOpen(true);
  };

  const onNativeChange = (event: any, selected?: Date) => {
    if (Platform.OS === "android") {
      setOpen(false);
      if (event.type === "set" && selected) {
        onChange(toISO(selected));
      }
    } else if (selected) {
      setTempDate(selected);
    }
  };

  const confirmIOS = () => {
    onChange(toISO(tempDate));
    setOpen(false);
  };

  return (
    <View>
      <TouchableOpacity
        testID={testID || "date-picker-field"}
        style={styles.field}
        onPress={openPicker}
        activeOpacity={0.7}
      >
        <Ionicons name="calendar-outline" size={18} color={colors.brand} />
        <Text style={styles.value}>{value ? formatDisplay(value) : "Select date"}</Text>
        <Ionicons name="chevron-down" size={18} color={colors.muted} />
      </TouchableOpacity>

      {Platform.OS === "android" && open && (
        <DateTimePicker
          value={tempDate}
          mode="date"
          display="default"
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          onChange={onNativeChange}
        />
      )}

      {Platform.OS === "ios" && (
        <Modal
          transparent
          visible={open}
          animationType="fade"
          onRequestClose={() => setOpen(false)}
        >
          <View style={styles.backdrop}>
            <View style={styles.sheet}>
              <View style={styles.sheetHeader}>
                <TouchableOpacity onPress={() => setOpen(false)} testID="date-picker-cancel">
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <Text style={styles.sheetTitle}>{label || "Select date"}</Text>
                <TouchableOpacity onPress={confirmIOS} testID="date-picker-confirm">
                  <Text style={styles.confirmText}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={tempDate}
                mode="date"
                display="spinner"
                minimumDate={minimumDate}
                maximumDate={maximumDate}
                onChange={onNativeChange}
                textColor={colors.onSurface}
                themeVariant="light"
                style={{ backgroundColor: colors.surfaceSecondary }}
              />
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md + 2,
    minHeight: 48,
  },
  value: { flex: 1, color: colors.onSurface, fontSize: 15, fontWeight: "500" },
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheet: {
    backgroundColor: colors.surfaceSecondary,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingBottom: spacing.xl,
  },
  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  sheetTitle: { fontWeight: "700", color: colors.onSurface, fontSize: 15 },
  cancelText: { color: colors.muted, fontSize: 15 },
  confirmText: { color: colors.brand, fontSize: 15, fontWeight: "700" },
});
