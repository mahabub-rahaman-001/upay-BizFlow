import { Pressable, Text, View } from "react-native";
import { tokens } from "./tokens";

export type AIConfidence = "high" | "medium" | "low";

export interface AICardProps {
  /** Two lines at most. The number in it must come from the facts JSON, never the model. */
  text: string;
  confidence: AIConfidence;
  /** Localised labels, supplied by the screen from the locale files. */
  labels: {
    /** The "(AI)" marker so the user always knows what is machine-written. */
    aiTag: string;
    why: string;
    confidence: Record<AIConfidence, string>;
  };
  onPressWhy: () => void;
}

/** A screen shows at most this many AI cards (CLAUDE.md UI rule). */
export const MAX_AI_CARDS = 1;

const confidenceKind: Record<AIConfidence, string> = {
  high: tokens.color.statusGood,
  medium: tokens.color.statusWarn,
  low: tokens.color.statusBad,
};

/**
 * The single AI card a screen is allowed. It is always marked as machine-written, always
 * states its confidence, and always offers "Why?" so advice can be traced back to the
 * numbers behind it (docs/04 section 10, docs/08). The card never moves money and never
 * presents a figure the facts JSON did not contain.
 */
export function AICard({ text, confidence, labels, onPressWhy }: AICardProps) {
  return (
    <View
      style={{
        backgroundColor: tokens.color.aiTint,
        borderLeftWidth: 4,
        borderLeftColor: tokens.color.aiBorder,
        borderRadius: tokens.radius.md,
        padding: tokens.space[4],
        gap: tokens.space[2],
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: tokens.space[2] }}>
        <Text
          style={{
            fontSize: tokens.font.size.caption,
            fontWeight: "700",
            color: tokens.color.aiBorder,
          }}
        >
          {labels.aiTag}
        </Text>
        <Text
          style={{
            fontSize: tokens.font.size.caption,
            color: confidenceKind[confidence],
            fontWeight: "700",
          }}
        >
          {labels.confidence[confidence]}
        </Text>
      </View>

      <Text
        numberOfLines={2}
        style={{
          fontSize: tokens.font.size.body,
          color: tokens.color.text,
          lineHeight: tokens.font.size.body * tokens.font.lineHeightBn,
        }}
      >
        {text}
      </Text>

      <Pressable
        accessibilityRole="button"
        onPress={onPressWhy}
        style={{ minHeight: tokens.touchMin, justifyContent: "center" }}
      >
        <Text
          style={{
            fontSize: tokens.font.size.label,
            color: tokens.color.brandPrimary,
            fontWeight: "700",
          }}
        >
          {labels.why}
        </Text>
      </Pressable>
    </View>
  );
}
