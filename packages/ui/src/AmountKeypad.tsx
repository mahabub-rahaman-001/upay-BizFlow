import { Pressable, Text, View } from "react-native";
import { formatMoney, takaToPoisha, type Poisha } from "@bizflow/shared";
import { tokens } from "./tokens";

export interface AmountKeypadProps {
  /** Whole taka as typed, e.g. "1250". The parent owns the string. */
  value: string;
  onChange: (next: string) => void;
  bangla?: boolean;
  /** Longest amount a shop will type; stops a stray key run creating a silly figure. */
  maxDigits?: number;
  /** Draw the typed amount above the keys. Screens with their own amount display turn it off. */
  showDisplay?: boolean;
  /** Shorter keys for sheets and small phones. */
  compact?: boolean;
  /** Accessibility label for the delete key, already localised. */
  deleteLabel?: string;
}

/** Whole taka from what has been typed, as integer poisha. Zero when nothing is typed. */
export function keypadAmountMinor(value: string): Poisha {
  const digits = value.replace(/[^\d]/g, "");
  return digits.length > 0 ? takaToPoisha(Number(digits)) : 0;
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "del"] as const;
const BN_DIGITS = "০১২৩৪৫৬৭৮৯";

function keyLabel(key: string, bangla: boolean) {
  if (key === "del") return "⌫";
  return bangla ? key.replace(/\d/g, (d) => BN_DIGITS[Number(d)]!) : key;
}

/**
 * The amount entry for every money screen (docs/04 section 10). It mirrors a calculator
 * because that is the one numeric interface these users already know, and it includes a
 * "00" key because shop amounts are mostly round hundreds. A long press on delete clears.
 *
 * The keypad never submits. The screen owns the amber Save button and keeps it in the same
 * place on every screen, so position carries meaning even when the words do not.
 */
export function AmountKeypad({
  value,
  onChange,
  bangla = false,
  maxDigits = 7,
  showDisplay = true,
  compact = false,
  deleteLabel = "delete",
}: AmountKeypadProps) {
  const press = (key: (typeof KEYS)[number]) => {
    if (key === "del") {
      onChange(value.slice(0, -1));
      return;
    }
    const next = (value + key).replace(/^0+(?=\d)/, "");
    if (next.replace(/[^\d]/g, "").length > maxDigits) return;
    onChange(next === "0" || next === "00" ? "" : next);
  };

  return (
    <View style={{ gap: tokens.space[3] }}>
      {showDisplay ? (
        <Text
          accessibilityLabel={formatMoney(keypadAmountMinor(value))}
          style={{
            fontSize: tokens.font.size.numberXl,
            lineHeight: 52,
            fontWeight: "700",
            color: value ? tokens.color.text : tokens.color.textMuted,
            textAlign: "center",
            fontVariant: ["tabular-nums"],
          }}
        >
          {formatMoney(keypadAmountMinor(value), { bangla, currency: "taka-sign" })}
        </Text>
      ) : null}

      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: tokens.space[2] }}>
        {KEYS.map((key) => (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityLabel={key === "del" ? deleteLabel : key}
            onPress={() => press(key)}
            onLongPress={key === "del" ? () => onChange("") : undefined}
            style={({ pressed }) => ({
              width: "32%",
              height: compact ? 50 : 58,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: tokens.radius.md,
              backgroundColor: pressed ? tokens.color.brandSoft : key === "del" ? tokens.color.surfaceMuted : tokens.color.surface,
              transform: [{ scale: pressed ? tokens.motion.pressScale : 1 }],
            })}
          >
            <Text
              style={{
                fontSize: key === "del" ? 22 : 24,
                lineHeight: 32,
                fontWeight: "600",
                color: tokens.color.text,
              }}
            >
              {keyLabel(key, bangla)}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
