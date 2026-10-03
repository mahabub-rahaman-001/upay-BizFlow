import { Pressable, Text, View } from "react-native";
import { tokens } from "./tokens";

export interface ActionItem {
  key: string;
  /** Single glyph shown at the start of the row. */
  icon: string;
  label: string;
  onPress: () => void;
}

export interface ActionListProps {
  items: ActionItem[];
  /** Label for the overflow row when there are more than three actions. */
  moreLabel?: string;
  onPressMore?: () => void;
}

/** A screen shows at most this many actions (CLAUDE.md UI rule, docs/04 section 10). */
export const MAX_ACTIONS = 3;

/**
 * At most three rows, each icon plus one line plus chevron. Anything beyond the third
 * action collapses into a single "More" row rather than making the user scan a long list.
 */
export function ActionList({ items, moreLabel, onPressMore }: ActionListProps) {
  const visible = items.slice(0, MAX_ACTIONS);
  const overflow = items.length > MAX_ACTIONS;

  return (
    <View
      style={{
        backgroundColor: tokens.color.surface,
        borderRadius: tokens.radius.md,
        overflow: "hidden",
      }}
    >
      {visible.map((item, i) => (
        <Row
          key={item.key}
          icon={item.icon}
          label={item.label}
          onPress={item.onPress}
          divider={i < visible.length - 1 || overflow}
        />
      ))}
      {overflow && moreLabel ? (
        <Row icon="+" label={moreLabel} onPress={onPressMore ?? (() => {})} divider={false} />
      ) : null}
    </View>
  );
}

function Row({
  icon,
  label,
  onPress,
  divider,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  divider: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: tokens.space[3],
        minHeight: tokens.touchMin,
        paddingHorizontal: tokens.space[4],
        paddingVertical: tokens.space[3],
        borderBottomWidth: divider ? 1 : 0,
        borderBottomColor: tokens.color.divider,
        backgroundColor: pressed ? tokens.color.bg : tokens.color.surface,
      })}
    >
      <Text style={{ fontSize: tokens.font.size.title, color: tokens.color.brandPrimary }}>
        {icon}
      </Text>
      <Text
        style={{ flex: 1, fontSize: tokens.font.size.body, color: tokens.color.text }}
        numberOfLines={1}
      >
        {label}
      </Text>
      <Text style={{ fontSize: tokens.font.size.body, color: tokens.color.textMuted }}>
        {">"}
      </Text>
    </Pressable>
  );
}
