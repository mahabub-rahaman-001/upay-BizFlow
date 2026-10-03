import { ActivityIndicator, Pressable, Text, type PressableProps } from "react-native";
import { tokens } from "./tokens";

export interface PrimaryButtonProps extends Omit<PressableProps, "children" | "style"> {
  label: string;
  busy?: boolean;
}

/**
 * The one amber action per screen (docs/04 section 10). Full width, 56dp tall, dark text
 * on amber, and it keeps its position across releases because novice users navigate by
 * where a control is, not by reading it (docs/04 section 12.3).
 */
export function PrimaryButton({ label, busy = false, disabled, ...rest }: PrimaryButtonProps) {
  const inactive = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy }}
      disabled={inactive}
      style={({ pressed }) => ({
        height: tokens.buttonHeight,
        borderRadius: tokens.radius.lg,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: tokens.color.actionPrimary,
        // Pressed state is a dim of the same amber: the button never changes hue, so the
        // user's eye stays on the one control that matters.
        opacity: inactive ? 0.52 : 1,
        transform: [{ scale: pressed && !inactive ? 0.985 : 1 }],
        shadowColor: tokens.color.brandPrimaryDark,
        shadowOpacity: inactive ? 0 : 0.14,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 5 },
        elevation: inactive ? 0 : 2,
      })}
      {...rest}
    >
      {busy ? (
        <ActivityIndicator color={tokens.color.actionPrimaryText} />
      ) : (
        <Text
          style={{
            color: tokens.color.actionPrimaryText,
            fontSize: tokens.font.size.body,
            fontWeight: "700",
          }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}
