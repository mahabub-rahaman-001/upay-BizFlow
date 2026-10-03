import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View, type PressableProps } from "react-native";
import { tokens } from "./tokens";
import { uiFeedback } from "./feedback";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface PrimaryButtonProps extends Omit<PressableProps, "children" | "style"> {
  label: string;
  busy?: boolean;
  /**
   * primary: the one amber action per screen. secondary: brand outline for the second
   * choice. ghost: text-weight action. danger: outlined red for sign-out style actions.
   */
  variant?: ButtonVariant;
  /** Optional leading icon element. */
  icon?: ReactNode;
  /** Shorter button for sheets and inline rows. */
  compact?: boolean;
}

const looks: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
  primary: { bg: tokens.color.actionPrimary, fg: tokens.color.actionPrimaryText, border: tokens.color.actionPrimary },
  secondary: { bg: tokens.color.surface, fg: tokens.color.brandPrimary, border: tokens.color.brandPrimary },
  ghost: { bg: "transparent", fg: tokens.color.brandPrimary, border: "transparent" },
  danger: { bg: tokens.color.surface, fg: tokens.color.statusBad, border: tokens.color.statusBad },
};

/**
 * The amber action (docs/04 section 10). Full width, 56dp tall, dark text on amber, and it
 * keeps its position across releases because novice users navigate by where a control is,
 * not by reading it (docs/04 section 12.3). Only one primary variant per screen.
 */
export function PrimaryButton({
  label,
  busy = false,
  disabled,
  variant = "primary",
  icon,
  compact = false,
  onPressIn,
  ...rest
}: PrimaryButtonProps) {
  const inactive = disabled || busy;
  const look = looks[variant];
  const elevated = variant === "primary" && !inactive;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy }}
      disabled={inactive}
      onPressIn={(event) => {
        // Light haptic on the primary action only; secondary buttons stay silent.
        if (variant === "primary") uiFeedback("tap");
        onPressIn?.(event);
      }}
      style={({ pressed }) => ({
        height: compact ? tokens.touchMin : tokens.buttonHeight,
        borderRadius: tokens.radius.md,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: tokens.space[4],
        backgroundColor: inactive && variant === "primary" ? tokens.color.surfaceMuted : look.bg,
        borderWidth: variant === "secondary" || variant === "danger" ? 1.5 : 0,
        borderColor: look.border,
        opacity: inactive && variant !== "primary" ? 0.5 : pressed ? 0.88 : 1,
        transform: [{ scale: pressed && !inactive ? (variant === "primary" ? tokens.motion.pressScalePrimary : tokens.motion.pressScale) : 1 }],
        ...(elevated ? tokens.shadow.card : {}),
      })}
      {...rest}
    >
      {busy ? (
        <ActivityIndicator color={variant === "primary" ? look.fg : tokens.color.brandPrimary} />
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: tokens.space[2] }}>
          {icon}
          <Text
            numberOfLines={1}
            style={{
              color: inactive && variant === "primary" ? tokens.color.textMuted : look.fg,
              fontSize: tokens.font.size.body,
              lineHeight: 24,
              fontWeight: "700",
            }}
          >
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
