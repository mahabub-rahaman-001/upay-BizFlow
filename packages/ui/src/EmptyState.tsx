import { Text, View } from "react-native";
import { tokens } from "./tokens";
import { PrimaryButton } from "./PrimaryButton";

export interface EmptyStateProps {
  /** One friendly line, e.g. "nothing yet - add your first sale". */
  message: string;
  /** A single call to action. An empty screen offers one way forward, never a menu. */
  actionLabel?: string;
  onPressAction?: () => void;
}

export function EmptyState({ message, actionLabel, onPressAction }: EmptyStateProps) {
  return (
    <View style={{ alignItems: "center", gap: tokens.space[4], padding: tokens.space[5] }}>
      <Text
        style={{
          fontSize: tokens.font.size.body,
          color: tokens.color.textMuted,
          textAlign: "center",
          lineHeight: tokens.font.size.body * tokens.font.lineHeightBn,
        }}
      >
        {message}
      </Text>
      {actionLabel && onPressAction ? (
        <View style={{ alignSelf: "stretch" }}>
          <PrimaryButton label={actionLabel} onPress={onPressAction} />
        </View>
      ) : null}
    </View>
  );
}
