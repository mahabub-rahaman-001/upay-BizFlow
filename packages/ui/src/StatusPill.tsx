import type { ReactNode } from "react";
import { Text, View, type ViewProps } from "react-native";
import { tokens } from "./tokens";

export type StatusKind = "good" | "warn" | "bad" | "neutral" | "manual" | "info";

export interface StatusPillProps extends ViewProps {
  kind: StatusKind;
  /** The word. Never ship a pill that carries meaning by colour alone. */
  label: string;
  /** Drawn before the word: an icon element, or a single glyph string. */
  icon?: ReactNode;
  /** Smaller pill for dense rows. */
  compact?: boolean;
}

export const statusPalette: Record<StatusKind, { fg: string; bg: string }> = {
  good: { fg: tokens.color.statusGood, bg: tokens.color.statusGoodBg },
  warn: { fg: tokens.color.statusWarn, bg: tokens.color.statusWarnBg },
  bad: { fg: tokens.color.statusBad, bg: tokens.color.statusBadBg },
  neutral: { fg: tokens.color.textMuted, bg: tokens.color.surfaceMuted },
  manual: { fg: tokens.color.manualTag, bg: tokens.color.manualTint },
  info: { fg: tokens.color.brandPrimary, bg: tokens.color.brandSoft },
};

/**
 * Status is icon plus word plus colour, in that order of importance (docs/04 section 6.4).
 * Colour is the last cue, so the pill still reads correctly in sunlight, on a worn
 * screen, or for a colour-blind user.
 */
export function StatusPill({ kind, label, icon, compact = false, style, ...rest }: StatusPillProps) {
  const { fg, bg } = statusPalette[kind];
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          alignSelf: "flex-start",
          gap: 4,
          backgroundColor: bg,
          borderRadius: tokens.radius.pill,
          paddingHorizontal: compact ? 8 : tokens.space[3],
          paddingVertical: compact ? 2 : 4,
        },
        style,
      ]}
      {...rest}
    >
      {typeof icon === "string" ? (
        <Text style={{ color: fg, fontSize: tokens.font.size.caption }}>{icon}</Text>
      ) : (
        icon ?? null
      )}
      <Text
        numberOfLines={1}
        style={{ color: fg, fontSize: compact ? 12 : tokens.font.size.caption, lineHeight: compact ? 18 : 20, fontWeight: "700" }}
      >
        {label}
      </Text>
    </View>
  );
}
