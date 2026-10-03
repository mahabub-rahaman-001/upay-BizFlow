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
}

/** Whole taka from what has been typed, as integer poisha. Zero when nothing is typed. */
export function keypadAmountMinor(value: string): Poisha {
  const digits = value.replace(/[^\d]/g, "");
  return digits.length > 0 ? takaToPoisha(Number(digits)) : 0;
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "del"] as const;

/**
 * The amount entry for every money screen (docs/04 section 10). It mirrors a calculator
 * because that is the one numeric interface these users already know, and it includes a
 * "00" key because shop amounts are mostly round hundreds.
 *
 * The keypad never submits. The screen owns the amber Save button and keeps it in the same
 * place on every screen, so position carries meaning even when the words do not.
 */
export function AmountKeypad({
  value,
  onChange,
  bangla = false,
  maxDigits = 7,
}: AmountKeypadProps) {
  const press = (key: (typeof KEYS)[number]) => {
    if (key === "del") {
      onChange(value.slice(0, -1));
      return;
    }
    const next = (value + key).replace(/^0+(?=\d)/, "");
    if (next.replace(/[^\d]/g, "").length > maxDigits) return;
    onChange(next);
  };

  return (
    <View style={{ gap: tokens.space[4] }}>
      <Text
        accessibilityLabel={formatMoney(keypadAmountMinor(value))}
        style={{
          fontSize: tokens.font.size.numberXl,
          fontWeight: "700",
          color: tokens.color.text,
          textAlign: "center",
          paddingVertical: tokens.space[3],
        }}
      >
        {formatMoney(keypadAmountMinor(value), { bangla })}
      </Text>

      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          justifyContent: "space-between",
          rowGap: tokens.space[2],
        }}
      >
        {KEYS.map((key) => (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityLabel={key === "del" ? "delete" : key}
            onPress={() => press(key)}
            style={({ pressed }) => ({
              width: "31%",
              minHeight: 64,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: tokens.radius.md,
              backgroundColor: pressed ? tokens.color.divider : tokens.color.surface,
            })}
          >
            <Text
              style={{
                fontSize: tokens.font.size.title,
                fontWeight: "600",
                color: tokens.color.text,
              }}
            >
              {key === "del" ? "<" : key}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
