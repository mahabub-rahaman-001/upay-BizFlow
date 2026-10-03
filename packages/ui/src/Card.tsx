import { Text, View, type ViewProps } from "react-native";
import { tokens } from "./tokens";

export interface CardProps extends ViewProps {
  /** Optional heading. Kept short; the card's numbers carry the message. */
  title?: string;
}

/** The standard surface: white, rounded, one step of padding. */
export function Card({ title, children, style, ...rest }: CardProps) {
  return (
    <View
      style={[
        {
          backgroundColor: tokens.color.surface,
          borderRadius: tokens.radius.md,
          padding: tokens.space[4],
          gap: tokens.space[2],
        },
        style,
      ]}
      {...rest}
    >
      {title ? (
        <Text style={{ fontSize: tokens.font.size.label, color: tokens.color.textMuted }}>
          {title}
        </Text>
      ) : null}
      {children}
    </View>
  );
}
