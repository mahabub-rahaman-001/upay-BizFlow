import { Text, View, type ViewProps } from "react-native";
import { tokens } from "./tokens";

export type StatusKind = "good" | "warn" | "bad" | "neutral";

export interface StatusPillProps extends ViewProps {
  kind: StatusKind;
  /** The word. Never ship a pill that carries meaning by colour alone. */
  label: string;
  /** Single glyph drawn before the word, e.g. a check or an exclamation mark. */
  icon: string;
}

const palette: Record<StatusKind, { fg: string; bg: string }> = {
  good: { fg: tokens.color.statusGood, bg: tokens.color.statusGoodBg },
  warn: { fg: tokens.color.statusWarn, bg: tokens.color.statusWarnBg },
  bad: { fg: tokens.color.statusBad, bg: tokens.color.statusBadBg },
  neutral: { fg: tokens.color.manualTag, bg: tokens.color.divider },
};

/**
 * Status is icon plus word plus colour, in that order of importance (docs/04 section 6.4).
 * Colour is the last cue, so the pill still reads correctly in sunlight, on a worn
 * screen, or for a colour-blind user.
 */
export function StatusPill({ kind, label, icon, style, ...rest }: StatusPillProps) {
  const { fg, bg } = palette[kind];
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          alignSelf: "flex-start",
          gap: tokens.space[1],
          backgroundColor: bg,
          borderRadius: tokens.radius.pill,
          paddingHorizontal: tokens.space[3],
          paddingVertical: tokens.space[1],
        },
        style,
      ]}
      {...rest}
    >
      <Text style={{ color: fg, fontSize: tokens.font.size.caption }}>{icon}</Text>
      <Text style={{ color: fg, fontSize: tokens.font.size.caption, fontWeight: "700" }}>
        {label}
      </Text>
    </View>
  );
}
