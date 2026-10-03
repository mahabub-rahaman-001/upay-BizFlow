import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions, type TextInputProps } from "react-native";
import { useTranslation } from "react-i18next";
import { MoneyText, tokens } from "@bizflow/ui";
import { AppIcon, type AppIconName } from "./AppIcon";

export function Section({ title, action, onAction, children }: { title: string; action?: string; onAction?: () => void; children: ReactNode }) {
  return <View style={ui.section}><View style={ui.row}><Text accessibilityRole="header" style={[ui.heading, ui.grow]}>{title}</Text>{action && onAction ? <TextButton label={action} onPress={onAction} /> : null}</View>{children}</View>;
}

export function Surface({ children }: { children: ReactNode }) { return <View style={ui.surface}>{children}</View>; }
export function TextButton({ label, onPress }: { label: string; onPress: () => void }) { return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [ui.textButton, pressed && ui.pressed]}><Text style={ui.link}>{label}</Text></Pressable>; }
export function IconButton({ name, label, onPress }: { name: AppIconName; label: string; onPress: () => void }) { return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [ui.iconButton, pressed && ui.pressed]}><AppIcon name={name} color={tokens.color.brandPrimary} /></Pressable>; }

export function ScreenHeader({ title, subtitle, onBack, action }: { title: string; subtitle?: string; onBack?: () => void; action?: ReactNode }) {
  const { t } = useTranslation();
  return <View style={ui.header}>{onBack ? <IconButton name="back" label={t("ux.back")} onPress={onBack} /> : null}<View style={ui.grow}><Text accessibilityRole="header" style={ui.title}>{title}</Text>{subtitle ? <Text style={ui.caption}>{subtitle}</Text> : null}</View>{action}</View>;
}

export function Notice({ title, body, kind = "info", action, onAction }: { title: string; body?: string; kind?: "info" | "warn" | "good" | "bad"; action?: string; onAction?: () => void }) {
  const fg = kind === "bad" ? tokens.color.statusBad : kind === "warn" ? tokens.color.statusWarn : kind === "good" ? tokens.color.statusGood : tokens.color.brandPrimary;
  return <View style={[ui.notice, { borderLeftColor: fg }]}><View style={ui.row}><AppIcon name={kind === "good" ? "closing" : "alert"} size={19} color={fg} /><Text style={[ui.label, ui.grow, { color: fg }]}>{title}</Text></View>{body ? <Text style={ui.body}>{body}</Text> : null}{action && onAction ? <TextButton label={action} onPress={onAction} /> : null}</View>;
}

export function Segments<T extends string>({ items, value, onChange }: { items: { key: T; label: string }[]; value: T; onChange: (key: T) => void }) {
  return <View style={ui.segments}>{items.map(item => <Pressable key={item.key} accessibilityRole="tab" accessibilityState={{ selected: item.key === value }} onPress={() => onChange(item.key)} style={[ui.segment, item.key === value && ui.segmentActive]}><Text style={[ui.segmentText, item.key === value && ui.segmentTextActive]}>{item.label}</Text></Pressable>)}</View>;
}

export function Field({ label, hint, ...props }: TextInputProps & { label: string; hint?: string }) {
  return <View style={ui.field}><Text style={ui.label}>{label}</Text><TextInput {...props} accessibilityLabel={label} placeholderTextColor={tokens.color.textMuted} style={[ui.input, props.style]} />{hint ? <Text style={ui.caption}>{hint}</Text> : null}</View>;
}

export function MenuRow({ icon, title, subtitle, onPress, trailing }: { icon: AppIconName; title: string; subtitle?: string; onPress?: () => void; trailing?: ReactNode }) {
  return <Pressable accessibilityRole={onPress ? "button" : "text"} onPress={onPress} style={({ pressed }) => [ui.menuRow, pressed && onPress ? ui.pressed : null]}><View style={ui.iconTile}><AppIcon name={icon} color={tokens.color.brandPrimary} size={23} /></View><View style={ui.grow}><Text style={ui.label}>{title}</Text>{subtitle ? <Text style={ui.caption}>{subtitle}</Text> : null}</View>{trailing}{onPress ? <AppIcon name="chevron" color={tokens.color.textMuted} size={16} /> : null}</Pressable>;
}

export interface Feature { key: string; icon: AppIconName; label: string; onPress: () => void }
export function FeatureGrid({ items }: { items: Feature[] }) {
  const { width, fontScale } = useWindowDimensions();
  const columns = fontScale > 1.3 || width < 350 ? 2 : 3;
  return <View style={ui.grid}>{items.map(item => <View key={item.key} style={{ width: `${100 / columns}%`, padding: 4 }}><Pressable accessibilityRole="button" accessibilityLabel={item.label} onPress={item.onPress} style={({ pressed }) => [ui.feature, pressed && ui.pressed]}><View style={ui.iconTile}><AppIcon name={item.icon} size={25} color={tokens.color.brandPrimary} /></View><Text style={ui.featureLabel}>{item.label}</Text></Pressable></View>)}</View>;
}

export function BalanceHero({ title, cash, digital, digitalLabel, hidden, onToggle, loading, error, onRetry }: { title: string; cash?: number; digital?: number; digitalLabel: string; hidden: boolean; onToggle: () => void; loading?: boolean; error?: boolean; onRetry?: () => void }) {
  const { t, i18n } = useTranslation();
  const bn = i18n.language === "bn";
  return <View style={ui.balance}><View style={[ui.row, { justifyContent: "space-between" }]}><Text style={ui.balanceLabel}>{title}</Text><Pressable accessibilityRole="button" accessibilityLabel={t(hidden ? "ux.show_balance" : "ux.hide_balance")} onPress={onToggle} style={ui.balanceEye}><AppIcon name={hidden ? "eye" : "eye-off"} color="#D8E6EF" size={21} /></Pressable></View>{loading ? <View style={ui.skeleton} /> : error ? <View><Text style={ui.balanceLabel}>{t("ux.balance_unavailable")}</Text>{onRetry ? <Pressable onPress={onRetry} accessibilityRole="button" style={ui.textButton}><Text style={ui.balanceLabel}>{t("error.retry")}</Text></Pressable> : null}</View> : hidden ? <Text style={ui.mask}>••••••</Text> : <MoneyText amountMinor={(cash ?? 0) + (digital ?? 0)} bangla={bn} size="numberLg" style={ui.balanceAmount} />}<View style={ui.balanceParts}>{[{ label: t("home.cash"), amount: cash, icon: "cash" as const }, { label: digitalLabel, amount: digital, icon: "digital" as const }].map(part => <View key={part.label} style={ui.grow}><View style={ui.row}><AppIcon name={part.icon} color="#BBD4E4" size={17} /><Text style={ui.balanceLabel}>{part.label}</Text></View>{hidden || loading || error ? <Text style={ui.balanceLabel}>—</Text> : <MoneyText amountMinor={part.amount ?? 0} bangla={bn} style={ui.balanceSmall} />}</View>)}</View></View>;
}

export function BodyScroll({ children }: { children: ReactNode }) { return <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={ui.content}>{children}</ScrollView>; }

export const ui = StyleSheet.create({
  page: { flex: 1, backgroundColor: tokens.color.bg },
  content: { padding: 16, paddingBottom: 32, gap: 20 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, gap: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  grow: { flex: 1, minWidth: 0 },
  title: { fontSize: 22, lineHeight: 32, fontWeight: "700", color: tokens.color.text },
  heading: { fontSize: 18, lineHeight: 27, fontWeight: "700", color: tokens.color.text },
  label: { fontSize: 16, lineHeight: 24, fontWeight: "600", color: tokens.color.text },
  body: { fontSize: 15, lineHeight: 23, color: tokens.color.textMuted },
  caption: { fontSize: 13, lineHeight: 20, color: tokens.color.textMuted },
  link: { fontSize: 14, lineHeight: 21, fontWeight: "600", color: tokens.color.brandPrimary },
  section: { gap: 8 },
  surface: { backgroundColor: tokens.color.surface, borderRadius: 20, borderCurve: "continuous", padding: 16, gap: 12 },
  textButton: { minHeight: 48, justifyContent: "center", paddingHorizontal: 4 },
  pressed: { backgroundColor: tokens.color.brandSoft, opacity: 0.82 },
  iconButton: { width: 48, height: 48, borderRadius: 16, backgroundColor: tokens.color.surface, justifyContent: "center", alignItems: "center" },
  iconTile: { width: 44, height: 44, borderRadius: 14, backgroundColor: tokens.color.brandWash, justifyContent: "center", alignItems: "center" },
  notice: { backgroundColor: tokens.color.brandWash, borderLeftWidth: 3, borderRadius: 12, padding: 12, gap: 4 },
  segments: { flexDirection: "row", padding: 4, borderRadius: 16, backgroundColor: tokens.color.surfaceMuted, gap: 4 },
  segment: { flex: 1, paddingVertical: 12, paddingHorizontal: 6, minHeight: 48, justifyContent: "center", alignItems: "center", borderRadius: 12 },
  segmentActive: { backgroundColor: tokens.color.brandPrimary },
  segmentText: { fontSize: 14, lineHeight: 21, textAlign: "center", fontWeight: "600", color: tokens.color.textMuted },
  segmentTextActive: { color: tokens.color.surface },
  field: { gap: 6 },
  input: { minHeight: 56, borderWidth: 1, borderColor: tokens.color.divider, borderRadius: 14, backgroundColor: tokens.color.brandWash, paddingHorizontal: 16, paddingVertical: 12, color: tokens.color.text, fontSize: 17 },
  menuRow: { flexDirection: "row", alignItems: "center", minHeight: 72, gap: 12, paddingVertical: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", margin: -4 },
  feature: { minHeight: 112, padding: 10, gap: 8, alignItems: "center", justifyContent: "flex-start", backgroundColor: tokens.color.surface, borderRadius: 16 },
  featureLabel: { fontSize: 14, lineHeight: 21, fontWeight: "600", textAlign: "center", color: tokens.color.text },
  balance: { padding: 20, borderRadius: 24, borderCurve: "continuous", backgroundColor: tokens.color.brandPrimary, gap: 4 },
  balanceLabel: { fontSize: 14, lineHeight: 21, color: "#D8E6EF" },
  balanceEye: { minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" },
  balanceAmount: { color: "#FFFFFF", fontVariant: ["tabular-nums"], lineHeight: 48 },
  balanceSmall: { color: "#FFFFFF", fontSize: 16, lineHeight: 26 },
  balanceParts: { borderTopWidth: 1, borderTopColor: "#496C8A", marginTop: 16, paddingTop: 16, flexDirection: "row", gap: 16 },
  mask: { color: "#FFFFFF", fontSize: 32, lineHeight: 48, letterSpacing: 6 },
  skeleton: { height: 40, marginVertical: 4, borderRadius: 8, width: "70%", backgroundColor: "#496C8A" },
  footer: { padding: 16, backgroundColor: tokens.color.surface, borderTopWidth: 1, borderTopColor: tokens.color.divider, gap: 8 },
});
