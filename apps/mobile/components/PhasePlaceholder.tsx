import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { tokens } from "@bizflow/ui";

export interface PhasePlaceholderProps {
  title: string;
  /** Which build phase fills this screen, so the gap is visible rather than implied. */
  phase: string;
  /** What the finished screen will do, from the spec. */
  summary: string;
}

/**
 * A tab that the shell routes to but a later phase builds. It names the phase on screen
 * so a demo never mistakes an unbuilt screen for a broken one.
 */
export function PhasePlaceholder({ title, phase, summary }: PhasePlaceholderProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: tokens.color.bg,
        paddingTop: insets.top + tokens.space[5],
        paddingHorizontal: tokens.space[4],
        gap: tokens.space[3],
      }}
    >
      <Text
        style={{ fontSize: tokens.font.size.title, fontWeight: "700", color: tokens.color.text }}
      >
        {title}
      </Text>
      <Text style={{ fontSize: tokens.font.size.caption, color: tokens.color.brandPrimary }}>
        {phase}
      </Text>
      <Text
        style={{
          fontSize: tokens.font.size.body,
          color: tokens.color.textMuted,
          lineHeight: tokens.font.size.body * tokens.font.lineHeightBn,
        }}
      >
        {summary}
      </Text>
    </View>
  );
}
