import { Pressable, Text, View } from "react-native";
import type { Poisha } from "@bizflow/shared";
import { MoneyText } from "./MoneyText";
import { StatusPill } from "./StatusPill";
import { tokens } from "./tokens";

export interface TxnRowProps {
  /** What the entry is, already localised by the caller. */
  title: string;
  amountMinor: Poisha;
  /** Local time, already formatted; the row does no date maths. */
  time: string;
  /** A hand-entered row carries a grey Manual tag so trust is never implied. */
  source: "verified" | "manual";
  manualLabel: string;
  /** Shown when this entry has been reversed, so a correction is never hidden. */
  reversedLabel?: string;
  bangla?: boolean;
  onPress?: () => void;
}

/**
 * One line in the transaction list (docs/04 section 10). The amount is the loudest thing
 * on the row; the source mark says whether the number was proven by a payment or typed by
 * a person, which is the distinction this product is built on.
 */
export function TxnRow({
  title,
  amountMinor,
  time,
  source,
  manualLabel,
  reversedLabel,
  bangla = false,
  onPress,
}: TxnRowProps) {
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : "text"}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: tokens.space[3],
        minHeight: tokens.touchMin,
        paddingHorizontal: tokens.space[4],
        paddingVertical: tokens.space[3],
        borderBottomWidth: 1,
        borderBottomColor: tokens.color.divider,
        backgroundColor: pressed ? tokens.color.bg : tokens.color.surface,
      })}
    >
      <View style={{ flex: 1, gap: tokens.space[1] }}>
        <Text
          numberOfLines={1}
          style={{ fontSize: tokens.font.size.body, color: tokens.color.text }}
        >
          {title}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: tokens.space[2] }}>
          <Text style={{ fontSize: tokens.font.size.caption, color: tokens.color.textMuted }}>
            {time}
          </Text>
          {source === "manual" ? (
            <StatusPill kind="neutral" icon="-" label={manualLabel} />
          ) : null}
          {reversedLabel ? (
            <StatusPill kind="bad" icon="!" label={reversedLabel} />
          ) : null}
        </View>
      </View>
      <MoneyText amountMinor={amountMinor} bangla={bangla} />
    </Pressable>
  );
}
