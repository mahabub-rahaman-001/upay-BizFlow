import { Text, type TextProps } from "react-native";
import { formatMoney, moneyAccessibilityLabel, type Poisha } from "@bizflow/shared";
import { tokens } from "./tokens";

export type MoneySize = "caption" | "label" | "body" | "title" | "numberLg" | "numberXl";

export interface MoneyTextProps extends Omit<TextProps, "children"> {
  /** Amount in integer poisha. */
  amountMinor: Poisha;
  /** Bangla digits follow the user's language setting. */
  bangla?: boolean;
  size?: MoneySize;
  /** Dim the amount, for secondary figures next to a headline number. */
  muted?: boolean;
  /** White text for the brand-blue balance hero. */
  inverse?: boolean;
  /** Prefix a "+" on money in and a "-" on money out; the sign carries the direction. */
  signed?: "in" | "out";
}

const sizes: Record<MoneySize, number> = {
  caption: tokens.font.size.caption,
  label: tokens.font.size.label,
  body: tokens.font.size.body,
  title: tokens.font.size.title,
  numberLg: tokens.font.size.numberLg,
  numberXl: tokens.font.size.numberXl,
};

/**
 * The only way an amount reaches the screen. Near-black, lakh-grouped and tabular per
 * docs/04 section 10, and it always carries an accessibilityLabel so a screen reader or the
 * read-aloud feature speaks the full amount including paisa. Amounts are never coloured:
 * direction is a sign and an icon, colour stays reserved for status.
 */
export function MoneyText({
  amountMinor,
  bangla = false,
  size = "body",
  muted = false,
  inverse = false,
  signed,
  style,
  ...rest
}: MoneyTextProps) {
  const fontSize = sizes[size];
  const big = size === "numberLg" || size === "numberXl";
  const body = formatMoney(Math.abs(amountMinor), { bangla, currency: "taka-sign" });
  const prefix = signed === "in" ? "+" : signed === "out" || amountMinor < 0 ? "-" : "";
  return (
    <Text
      accessibilityLabel={moneyAccessibilityLabel(amountMinor)}
      style={[
        {
          fontSize,
          lineHeight: Math.round(fontSize * (big ? 1.25 : 1.45)),
          letterSpacing: big ? -0.5 : 0,
          color: inverse ? tokens.color.onBrand : muted ? tokens.color.textMuted : tokens.color.text,
          fontWeight: big || size === "title" ? "700" : "600",
          fontVariant: ["tabular-nums"],
        },
        style,
      ]}
      {...rest}
    >
      {prefix + body}
    </Text>
  );
}
