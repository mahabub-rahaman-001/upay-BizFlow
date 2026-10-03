import type { ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { AmountKeypad, PrimaryButton, tokens } from "@bizflow/ui";

export interface MoneyEntryScreenProps {
  title: string;
  amount: string;
  onAmountChange: (next: string) => void;
  /** Options below the keypad: categories, who was paid, which customer. */
  children?: ReactNode;
  saveLabel: string;
  canSave: boolean;
  busy?: boolean;
  /** Already localised. */
  error?: string | null;
  onSave: () => void;
}

/**
 * The shared chrome for every money entry screen, so the amount, the options and the amber
 * Save button sit at the same height on all of them. Novice users navigate by position
 * rather than by reading, and docs/04 section 12.3 makes that a rule: the Save button never
 * moves, within a screen or between them.
 */
export function MoneyEntryScreen({
  title,
  amount,
  onAmountChange,
  children,
  saveLabel,
  canSave,
  busy = false,
  error,
  onSave,
}: MoneyEntryScreenProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t, i18n } = useTranslation();

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: tokens.color.bg,
        paddingTop: insets.top + tokens.space[3],
      }}
    >
      <View
        style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: tokens.space[4] }}
      >
        <Text
          style={{
            flex: 1,
            fontSize: tokens.font.size.title,
            fontWeight: "700",
            color: tokens.color.text,
          }}
        >
          {title}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
          onPress={() => router.back()}
          style={{
            minWidth: tokens.touchMin,
            minHeight: tokens.touchMin,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontSize: tokens.font.size.title, color: tokens.color.textMuted }}>x</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: tokens.space[4], gap: tokens.space[4] }}
        keyboardShouldPersistTaps="handled"
      >
        <AmountKeypad
          value={amount}
          onChange={onAmountChange}
          bangla={i18n.language === "bn"}
        />
        {children}
        {error ? (
          <Text style={{ color: tokens.color.statusBad, fontSize: tokens.font.size.label }}>
            {error}
          </Text>
        ) : null}
      </ScrollView>

      <View
        style={{
          padding: tokens.space[4],
          paddingBottom: insets.bottom + tokens.space[4],
          backgroundColor: tokens.color.bg,
        }}
      >
        <PrimaryButton label={saveLabel} busy={busy} disabled={!canSave} onPress={onSave} />
        <Text
          style={{
            fontSize: tokens.font.size.caption,
            color: tokens.color.textMuted,
            textAlign: "center",
            paddingTop: tokens.space[2],
          }}
        >
          {t("common.fixable")}
        </Text>
      </View>
    </View>
  );
}

/** A row of single-choice chips, used for categories, payment source and so on. */
export function ChoiceRow({
  options,
  value,
  onChange,
  allowClear = false,
}: {
  options: { key: string; label: string }[];
  value: string | null;
  onChange: (next: string | null) => void;
  allowClear?: boolean;
}) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.space[2] }}>
      {options.map((option) => {
        const selected = value === option.key;
        return (
          <Pressable
            key={option.key}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(selected && allowClear ? null : option.key)}
            style={{
              minHeight: tokens.touchMin,
              justifyContent: "center",
              paddingHorizontal: tokens.space[4],
              borderRadius: tokens.radius.pill,
              borderWidth: selected ? 2 : 1,
              borderColor: selected ? tokens.color.brandPrimary : tokens.color.divider,
              backgroundColor: tokens.color.surface,
            }}
          >
            <Text
              style={{
                fontSize: tokens.font.size.label,
                fontWeight: selected ? "700" : "400",
                color: selected ? tokens.color.brandPrimary : tokens.color.text,
              }}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
