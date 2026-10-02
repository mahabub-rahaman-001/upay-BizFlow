import type { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { AmountKeypad, PrimaryButton, keypadAmountMinor, tokens } from "@bizflow/ui";
import { AppIcon } from "./AppIcon";
import { ChipBar, IconButton, Notice, SourceBadge, type, useBangla } from "./kit";
import { AnimatedMoney, SuccessSheet, type SuccessInfo } from "./motion";
import { goBack } from "../lib/view";

const c = tokens.color;

export interface MoneyEntryScreenProps {
  title: string;
  amount: string;
  onAmountChange: (next: string) => void;
  /** Options between the amount and the keypad: category, wallet, customer. */
  children?: ReactNode;
  saveLabel: string;
  canSave: boolean;
  busy?: boolean;
  /** Already localised. */
  error?: string | null;
  onSave: () => void;
  /** Shown after a successful save; Done goes back, "Add another" resets the form. */
  success?: SuccessInfo | null;
  onAddAnother?: () => void;
  /** Hand-written entries say so up front; nothing here moves money. */
  manual?: boolean;
}

/**
 * The frame for every money entry (docs/04 13.5, docs/16 section 4): the amount at the top,
 * a few options, then the keypad and the amber Save in the thumb zone. Save never moves,
 * within a screen or between screens, because novice users navigate by position.
 */
export function MoneyEntryScreen({ title, amount, onAmountChange, children, saveLabel, canSave, busy = false, error, onSave, success, onAddAnother, manual = true }: MoneyEntryScreenProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useTranslation();
  const bangla = useBangla();
  const amountMinor = keypadAmountMinor(amount);

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <IconButton name="back" label={t("ux.back")} onPress={() => goBack(router)} />
        <Text accessibilityRole="header" numberOfLines={1} style={[type.title, { flex: 1 }]}>{title}</Text>
        {manual ? <SourceBadge source="manual" compact={false} /> : null}
      </View>

      <View style={[s.amountBox, manual && s.amountManual]}>
        <AnimatedMoney amountMinor={amountMinor} size="numberXl" muted={amountMinor === 0} />
        {manual ? (
          <View style={s.recordOnly}><AppIcon name="pen" size={13} color={c.manualTag} /><Text style={[type.caption, { color: c.manualTag }]}>{t("ux.record_only")}</Text></View>
        ) : null}
      </View>

      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={s.options}>
        {children}
        {error ? <Notice kind="bad" title={error} /> : null}
      </ScrollView>

      <View style={[s.bottom, { paddingBottom: Math.max(insets.bottom, tokens.space[3]) + 4 }]}>
        <AmountKeypad value={amount} onChange={onAmountChange} bangla={bangla} showDisplay={false} compact deleteLabel={t("ux.delete_digit")} />
        <PrimaryButton label={saveLabel} busy={busy} disabled={!canSave} onPress={onSave} />
      </View>

      <SuccessSheet
        info={success ?? null}
        onDone={() => goBack(router)}
        secondary={onAddAnother ? { label: t("ux.add_another"), onPress: onAddAnother } : undefined}
      />
    </View>
  );
}

/** A labelled row of single-choice chips, used for categories, wallets and payment source. */
export function ChoiceRow({ label, options, value, onChange, allowClear = false }: { label?: string; options: { key: string; label: string }[]; value: string | null; onChange: (next: string | null) => void; allowClear?: boolean }) {
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={type.label}>{label}</Text> : null}
      <ChipBar wrap items={options} value={value} onChange={(key) => onChange(value === key && allowClear ? null : key)} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  header: { flexDirection: "row", alignItems: "center", gap: tokens.space[3], paddingHorizontal: tokens.space[4], paddingVertical: tokens.space[2] },
  amountBox: { marginHorizontal: tokens.space[4], paddingVertical: tokens.space[3], borderRadius: tokens.radius.lg, alignItems: "center", gap: 2, backgroundColor: c.surface },
  amountManual: { backgroundColor: c.manualTint, borderWidth: 1, borderColor: c.manualBorder },
  recordOnly: { flexDirection: "row", alignItems: "center", gap: 4 },
  options: { padding: tokens.space[4], gap: tokens.space[4], width: "100%", maxWidth: 560, alignSelf: "center" },
  bottom: { paddingHorizontal: tokens.space[4], paddingTop: tokens.space[3], gap: tokens.space[3], backgroundColor: c.surfaceMuted, borderTopLeftRadius: tokens.radius.xl, borderTopRightRadius: tokens.radius.xl, width: "100%", maxWidth: 600, alignSelf: "center" },
});
