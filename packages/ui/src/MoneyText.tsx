import { Text, type TextProps } from "react-native";
import { formatMoney, moneyAccessibilityLabel, type Poisha } from "@bizflow/shared";
import { tokens } from "./tokens";

export type MoneySize = "body" | "title" | "numberLg" | "numberXl";

export interface MoneyTextProps extends Omit<TextProps, "children"> {
  /** Amount in integer poisha. */
  amountMinor: Poisha;
  /** Bangla digits follow the user's language setting. */
  bangla?: boolean;
  size?: MoneySize;
  /** Dim the amount, for secondary figures next to a headline number. */
  muted?: boolean;
}

/**
 * The only way an amount reaches the screen. Near-black and lakh-grouped per docs/04
 * section 10, and it always carries an accessibilityLabel so a screen reader or the
 * read-aloud feature speaks the full amount including paisa.
 */
export function MoneyText({
  amountMinor,
  bangla = false,
  size = "body",
  muted = false,
  style,
  ...rest
}: MoneyTextProps) {
  return (
    <Text
      accessibilityLabel={moneyAccessibilityLabel(amountMinor)}
      style={[
        {
          fontSize: tokens.font.size[size],
          color: muted ? tokens.color.textMuted : tokens.color.text,
          fontWeight: size === "body" ? "600" : "700",
        },
        style,
      ]}
      {...rest}
    >
      {formatMoney(amountMinor, { bangla })}
    </Text>
  );
}
