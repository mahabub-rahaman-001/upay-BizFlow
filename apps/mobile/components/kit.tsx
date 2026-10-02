/**
 * The BizFlow mobile kit: the small set of building blocks every screen is made of, so the
 * whole app speaks one design language (docs/16). Screens compose these; they do not
 * invent their own headers, rows, chips or sheets.
 */
import { useEffect, useRef, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import { MoneyText, tokens } from "@bizflow/ui";
import { AppIcon, type AppIconName } from "./AppIcon";
import { feedback, useReducedMotion } from "../lib/feedback";

const c = tokens.color;

// ---------------------------------------------------------------------------
// Type scale. Bangla needs generous line height so vowel marks never clip.
// ---------------------------------------------------------------------------

export const type = StyleSheet.create({
  display: { fontSize: 26, lineHeight: 36, fontWeight: "700", color: c.text, letterSpacing: -0.3 },
  title: { fontSize: 20, lineHeight: 30, fontWeight: "700", color: c.text },
  heading: { fontSize: 17, lineHeight: 26, fontWeight: "700", color: c.text },
  body: { fontSize: 16, lineHeight: 24, color: c.text },
  bodyMuted: { fontSize: 15, lineHeight: 23, color: c.textMuted },
  label: { fontSize: 14, lineHeight: 21, fontWeight: "600", color: c.text },
  caption: { fontSize: 13, lineHeight: 19, color: c.textMuted },
  link: { fontSize: 14, lineHeight: 21, fontWeight: "700", color: c.brandPrimary },
});

export function useBangla(): boolean {
  const { i18n } = useTranslation();
  return i18n.language !== "en";
}

/** A count or plain number in the reader's digits (Bangla digits unless English). */
export function useDigits(): (value: number | string) => string {
  const bangla = useBangla();
  return (value) => (bangla ? String(value).replace(/[0-9]/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]!) : String(value));
}

// ---------------------------------------------------------------------------
// Tones: the colour pairs an icon tile or a badge may use.
// ---------------------------------------------------------------------------

export type Tone = "brand" | "good" | "warn" | "bad" | "manual" | "ai" | "neutral" | "amber";

export const tones: Record<Tone, { fg: string; bg: string }> = {
  brand: { fg: c.brandPrimary, bg: c.brandSoft },
  good: { fg: c.statusGood, bg: c.statusGoodBg },
  warn: { fg: c.statusWarn, bg: c.statusWarnBg },
  bad: { fg: c.statusBad, bg: c.statusBadBg },
  manual: { fg: c.manualTag, bg: c.manualTint },
  ai: { fg: c.aiBorder, bg: c.aiTint },
  neutral: { fg: c.textMuted, bg: c.surfaceMuted },
  amber: { fg: "#7A4E00", bg: "#FFEBC2" },
};

// ---------------------------------------------------------------------------
// Page frame
// ---------------------------------------------------------------------------

interface ScreenProps {
  children: ReactNode;
  /** Header element, usually <ScreenHeader>. Sits above the scroll area. */
  header?: ReactNode;
  /** Pinned bottom area, usually the one amber action. */
  footer?: ReactNode;
  /** Render children inside a ScrollView (default) or as-is for lists. */
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  /** A screen that sits inside the tab bar does not need bottom safe-area padding. */
  inTabs?: boolean;
  background?: string;
  refreshControl?: React.ComponentProps<typeof ScrollView>["refreshControl"];
}

export function Screen({ children, header, footer, scroll = true, contentStyle, inTabs = false, background = c.bg, refreshControl }: ScreenProps) {
  const insets = useSafeAreaInsets();
  const bottomPad = inTabs ? tokens.space[5] : Math.max(insets.bottom, tokens.space[4]) + tokens.space[4];
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: background }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={{ flex: 1, paddingTop: insets.top }}>
        {header}
        {scroll ? (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            refreshControl={refreshControl}
            contentContainerStyle={[styles.content, { paddingBottom: footer ? tokens.space[4] : bottomPad }, contentStyle]}
          >
            <View style={styles.maxWidth}>{children}</View>
          </ScrollView>
        ) : (
          <View style={[{ flex: 1 }, contentStyle]}>{children}</View>
        )}
        {footer ? <BottomBar inTabs={inTabs}>{footer}</BottomBar> : null}
      </View>
    </KeyboardAvoidingView>
  );
}

export function BottomBar({ children, inTabs = false }: { children: ReactNode; inTabs?: boolean }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bottomBar, { paddingBottom: inTabs ? tokens.space[3] : Math.max(insets.bottom, tokens.space[3]) + tokens.space[1] }]}>
      <View style={[styles.maxWidth, { gap: tokens.space[2] }]}>{children}</View>
    </View>
  );
}

export function ScreenHeader({ title, subtitle, onBack, right, large = false }: { title: string; subtitle?: string; onBack?: () => void; right?: ReactNode; large?: boolean }) {
  const { t } = useTranslation();
  return (
    <View style={styles.header}>
      {onBack ? <IconButton name="back" label={t("ux.back")} onPress={onBack} /> : null}
      <View style={styles.grow}>
        <Text accessibilityRole="header" numberOfLines={1} style={large ? type.display : type.title}>{title}</Text>
        {subtitle ? <Text numberOfLines={1} style={type.caption}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function Section({ title, action, onAction, children, hint }: { title: string; action?: string; onAction?: () => void; children: ReactNode; hint?: string }) {
  return (
    <View style={{ gap: tokens.space[2] }}>
      <View style={styles.row}>
        <View style={styles.grow}>
          <Text accessibilityRole="header" style={type.heading}>{title}</Text>
          {hint ? <Text style={type.caption}>{hint}</Text> : null}
        </View>
        {action && onAction ? <TextLink label={action} onPress={onAction} trailingIcon="chevron" /> : null}
      </View>
      {children}
    </View>
  );
}

export function Card({ children, style, tone, padded = true, onPress, accessibilityLabel }: { children: ReactNode; style?: StyleProp<ViewStyle>; tone?: "manual" | "ai" | "brand"; padded?: boolean; onPress?: () => void; accessibilityLabel?: string }) {
  const toneStyle = tone === "manual" ? styles.cardManual : tone === "ai" ? styles.cardAi : tone === "brand" ? styles.cardBrand : null;
  const base = [styles.card, padded && styles.cardPad, toneStyle, style];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => [...base, pressed && styles.pressed]}>
      {children}
    </Pressable>
  );
}

export function Divider({ inset = 0 }: { inset?: number }) {
  return <View style={{ height: StyleSheet.hairlineWidth * 2, backgroundColor: c.divider, marginLeft: inset }} />;
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

export function IconTile({ name, tone = "brand", size = 44, iconSize }: { name: AppIconName; tone?: Tone; size?: number; iconSize?: number }) {
  const { fg, bg } = tones[tone];
  return (
    <View style={{ width: size, height: size, borderRadius: Math.round(size * 0.32), backgroundColor: bg, alignItems: "center", justifyContent: "center" }}>
      <AppIcon name={name} color={fg} size={iconSize ?? Math.round(size * 0.52)} />
    </View>
  );
}

export function IconButton({ name, label, onPress, tone = "plain", badge }: { name: AppIconName; label: string; onPress: () => void; tone?: "plain" | "onBrand"; badge?: number }) {
  const onBrand = tone === "onBrand";
  const digits = useDigits();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.iconButton, onBrand && styles.iconButtonOnBrand, pressed && { opacity: 0.7, transform: [{ scale: tokens.motion.pressScale }] }]}
    >
      <AppIcon name={name} color={onBrand ? c.onBrand : c.brandPrimary} size={22} />
      {badge && badge > 0 ? (
        <View style={styles.badge}><Text style={styles.badgeText}>{digits(badge > 9 ? "9+" : badge)}</Text></View>
      ) : null}
    </Pressable>
  );
}

export function TextLink({ label, onPress, trailingIcon, tone = "brand", disabled }: { label: string; onPress: () => void; trailingIcon?: AppIconName; tone?: "brand" | "muted" | "bad"; disabled?: boolean }) {
  const color = tone === "muted" ? c.textMuted : tone === "bad" ? c.statusBad : c.brandPrimary;
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} hitSlop={6} style={({ pressed }) => [styles.textLink, (pressed || disabled) && { opacity: 0.6 }]}>
      <Text style={[type.link, { color }]}>{label}</Text>
      {trailingIcon ? <AppIcon name={trailingIcon} color={color} size={16} strokeWidth={2.2} /> : null}
    </Pressable>
  );
}

export function Segmented<T extends string>({ items, value, onChange }: { items: { key: T; label: string; icon?: AppIconName }[]; value: T; onChange: (key: T) => void }) {
  return (
    <View accessibilityRole="tablist" style={styles.segments}>
      {items.map((item) => {
        const selected = item.key === value;
        return (
          <Pressable key={item.key} accessibilityRole="tab" accessibilityState={{ selected }} onPress={() => { if (!selected) feedback("tap"); onChange(item.key); }} style={[styles.segment, selected && styles.segmentActive]}>
            {item.icon ? <AppIcon name={item.icon} size={18} color={selected ? c.brandPrimary : c.textMuted} /> : null}
            <Text numberOfLines={1} style={[styles.segmentText, selected && styles.segmentTextActive]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({ label, selected, onPress, icon }: { label: string; selected: boolean; onPress: () => void; icon?: AppIconName }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={() => { feedback("tap"); onPress(); }} style={({ pressed }) => [styles.chip, selected && styles.chipActive, pressed && { opacity: 0.8 }]}>
      {icon ? <AppIcon name={icon} size={16} color={selected ? c.onBrand : c.textMuted} /> : null}
      <Text numberOfLines={1} style={[styles.chipText, selected && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

/** Horizontal filter chips; scrolls when they do not fit. */
export function ChipBar<T extends string>({ items, value, onChange, wrap = false }: { items: { key: T; label: string; icon?: AppIconName }[]; value: T | null; onChange: (key: T) => void; wrap?: boolean }) {
  const chips = items.map((item) => <Chip key={item.key} label={item.label} icon={item.icon} selected={item.key === value} onPress={() => onChange(item.key)} />);
  if (wrap) return <View style={styles.chipWrap}>{chips}</View>;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: tokens.space[2], paddingRight: tokens.space[4] }}>
      {chips}
    </ScrollView>
  );
}

/** A large choice with an icon, for "what was it for" style questions. */
export function ChoiceCard({ icon, label, hint, selected, onPress, tone = "brand" }: { icon: AppIconName; label: string; hint?: string; selected: boolean; onPress: () => void; tone?: Tone }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={onPress} style={({ pressed }) => [styles.choiceCard, selected && styles.choiceCardActive, pressed && { opacity: 0.85 }]}>
      <IconTile name={icon} tone={selected ? "brand" : tone} size={40} />
      <View style={styles.grow}>
        <Text style={type.label}>{label}</Text>
        {hint ? <Text style={type.caption} numberOfLines={2}>{hint}</Text> : null}
      </View>
      <View style={[styles.radio, selected && styles.radioOn]}>{selected ? <AppIcon name="check" size={14} color={c.onBrand} strokeWidth={2.6} /> : null}</View>
    </Pressable>
  );
}

interface FieldProps extends TextInputProps {
  label: string;
  hint?: string;
  error?: string | null;
  prefix?: string;
  icon?: AppIconName;
}

export function Field({ label, hint, error, prefix, icon, style, ...props }: FieldProps) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={type.label}>{label}</Text>
      <View style={[styles.inputWrap, error ? styles.inputError : null]}>
        {icon ? <AppIcon name={icon} size={20} color={c.textMuted} /> : null}
        {prefix ? <Text style={styles.prefix}>{prefix}</Text> : null}
        <TextInput {...props} accessibilityLabel={label} placeholderTextColor={c.textMuted} style={[styles.input, style]} />
      </View>
      {error ? (
        <View style={styles.row}><AppIcon name="alert" size={15} color={c.statusBad} /><Text accessibilityRole="alert" style={[type.caption, { color: c.statusBad, flex: 1 }]}>{error}</Text></View>
      ) : hint ? <Text style={type.caption}>{hint}</Text> : null}
    </View>
  );
}

export function Notice({ title, body, kind = "info", action, onAction, icon }: { title: string; body?: string; kind?: "info" | "warn" | "good" | "bad" | "manual" | "ai"; action?: string; onAction?: () => void; icon?: AppIconName }) {
  const tone: Tone = kind === "info" ? "brand" : kind;
  const { fg, bg } = tones[tone];
  const fallbackIcon: AppIconName = kind === "good" ? "closing" : kind === "manual" ? "pen" : kind === "ai" ? "sparkle" : kind === "info" ? "info" : "alert";
  return (
    <View style={[styles.notice, { backgroundColor: bg }]}>
      <AppIcon name={icon ?? fallbackIcon} size={20} color={fg} />
      <View style={[styles.grow, { gap: 2 }]}>
        <Text style={[type.label, { color: kind === "info" || kind === "ai" ? c.text : fg }]}>{title}</Text>
        {body ? <Text style={[type.caption, { color: c.text }]}>{body}</Text> : null}
        {action && onAction ? <TextLink label={action} onPress={onAction} /> : null}
      </View>
    </View>
  );
}

export function ListRow({ icon, tone = "brand", title, subtitle, trailing, onPress, chevron = !!onPress, accessibilityLabel }: { icon?: AppIconName; tone?: Tone; title: string; subtitle?: string; trailing?: ReactNode; onPress?: () => void; chevron?: boolean; accessibilityLabel?: string }) {
  const content = (
    <>
      {icon ? <IconTile name={icon} tone={tone} size={40} /> : null}
      <View style={[styles.grow, { gap: 1 }]}>
        <Text numberOfLines={1} style={type.label}>{title}</Text>
        {subtitle ? <Text numberOfLines={2} style={type.caption}>{subtitle}</Text> : null}
      </View>
      {trailing}
      {chevron ? <AppIcon name="chevron" size={16} color={c.textMuted} /> : null}
    </>
  );
  if (!onPress) return <View style={styles.listRow}>{content}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title} onPress={onPress} style={({ pressed }) => [styles.listRow, pressed && styles.pressedRow]}>
      {content}
    </Pressable>
  );
}

/** Label on the left, an amount on the right. Used by every breakdown. */
export function AmountRow({ label, amount, strong = false, sign, hint }: { label: string; amount: number; strong?: boolean; sign?: "in" | "out"; hint?: string }) {
  const bangla = useBangla();
  return (
    <View style={styles.amountRow}>
      <View style={styles.grow}>
        <Text style={strong ? type.label : [type.body, { color: c.textMuted, fontSize: 15 }]}>{label}</Text>
        {hint ? <Text style={type.caption}>{hint}</Text> : null}
      </View>
      <MoneyText amountMinor={amount} bangla={bangla} size={strong ? "title" : "body"} signed={sign} />
    </View>
  );
}

export function ProgressBar({ value, tone = "brand", height = 8 }: { value: number; tone?: Tone; height?: number }) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View style={{ height, borderRadius: height, backgroundColor: c.surfaceMuted, overflow: "hidden" }}>
      <View style={{ width: `${pct * 100}%`, height, borderRadius: height, backgroundColor: tones[tone].fg }} />
    </View>
  );
}

/** "Verified by the provider" versus "written by hand" - the distinction the product rests on. */
export function SourceBadge({ source, compact = true }: { source: "verified" | "manual"; compact?: boolean }) {
  const { t } = useTranslation();
  const manual = source === "manual";
  const tone = manual ? tones.manual : tones.good;
  return (
    <View accessibilityLabel={t(manual ? "ux.manual_records" : "ux.verified_records")} style={[styles.sourceBadge, { backgroundColor: tone.bg, paddingVertical: compact ? 1 : 3 }]}>
      <AppIcon name={manual ? "pen" : "verified"} size={compact ? 12 : 14} color={tone.fg} strokeWidth={2} />
      <Text style={[styles.sourceText, { color: tone.fg }]}>{t(manual ? "ux.manual_short" : "ux.verified_short")}</Text>
    </View>
  );
}

export function StepHeader({ step, total, label }: { step: number; total: number; label?: string }) {
  const { t } = useTranslation();
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {Array.from({ length: total }, (_, i) => (
          <View key={i} style={{ flex: 1, height: 4, borderRadius: 4, backgroundColor: i < step ? c.brandPrimary : c.divider }} />
        ))}
      </View>
      <Text style={type.caption}>{label ?? t("ux.step_of", { step, total })}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Feature grid (the familiar MFS-style tiles on Home)
// ---------------------------------------------------------------------------

export interface Feature { key: string; icon: AppIconName; label: string; onPress: () => void; tone?: Tone; badge?: string }

export function FeatureGrid({ items, columns: forced }: { items: Feature[]; columns?: number }) {
  const { width, fontScale } = useWindowDimensions();
  const columns = forced ?? (fontScale > 1.3 || width < 340 ? 3 : 4);
  return (
    <View style={styles.grid}>
      {items.map((item) => (
        <View key={item.key} style={{ width: `${100 / columns}%`, padding: 4 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={item.label} onPressIn={() => feedback("tap")} onPress={item.onPress} style={({ pressed }) => [styles.feature, pressed && { backgroundColor: c.brandWash, transform: [{ scale: tokens.motion.pressScale }] }]}>
            <IconTile name={item.icon} tone={item.tone ?? "brand"} size={46} />
            <Text numberOfLines={2} style={styles.featureLabel}>{item.label}</Text>
            {item.badge ? <View style={styles.featureBadge}><Text style={styles.badgeText}>{item.badge}</Text></View> : null}
          </Pressable>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// States: loading, empty, error
// ---------------------------------------------------------------------------

export function Skeleton({ height = 16, width = "100%", radius = 8, style }: { height?: number; width?: ViewStyle["width"]; radius?: number; style?: StyleProp<ViewStyle> }) {
  const pulse = useRef(new Animated.Value(0.55)).current;
  const still = useReducedMotion();
  useEffect(() => {
    if (still) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
      Animated.timing(pulse, { toValue: 0.55, duration: 650, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse, still]);
  return <Animated.View style={[{ height, width, borderRadius: radius, backgroundColor: c.surfaceMuted, opacity: pulse }, style]} />;
}

export function SkeletonRows({ count = 4 }: { count?: number }) {
  return (
    <View style={{ gap: tokens.space[3] }}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[styles.row, { gap: tokens.space[3] }]}>
          <Skeleton width={40} height={40} radius={13} />
          <View style={[styles.grow, { gap: 6 }]}><Skeleton width="62%" height={14} /><Skeleton width="38%" height={12} /></View>
          <Skeleton width={64} height={16} />
        </View>
      ))}
    </View>
  );
}

export function EmptyState({ icon = "books", title, body, action, onAction }: { icon?: AppIconName; title: string; body?: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.state}>
      <IconTile name={icon} tone="neutral" size={64} />
      <Text style={[type.heading, { textAlign: "center" }]}>{title}</Text>
      {body ? <Text style={[type.bodyMuted, { textAlign: "center", maxWidth: 300 }]}>{body}</Text> : null}
      {action && onAction ? <TextLink label={action} onPress={onAction} trailingIcon="chevron" /> : null}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <View accessibilityRole="alert" style={styles.state}>
      <IconTile name="wifi-off" tone="bad" size={64} />
      <Text style={[type.heading, { textAlign: "center" }]}>{message ?? t("error.generic")}</Text>
      <Text style={[type.bodyMuted, { textAlign: "center", maxWidth: 300 }]}>{t("ux.error_body")}</Text>
      {onRetry ? <TextLink label={t("error.retry")} onPress={onRetry} trailingIcon="refresh" /> : null}
    </View>
  );
}

export function LoadingState() {
  return <View style={styles.state}><ActivityIndicator color={c.brandPrimary} /></View>;
}

// ---------------------------------------------------------------------------
// Bottom sheet
// ---------------------------------------------------------------------------

export function Sheet({ visible, onClose, title, subtitle, children, footer }: { visible: boolean; onClose: () => void; title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { height } = useWindowDimensions();
  const still = useReducedMotion();
  const slide = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (visible) {
      slide.setValue(0);
      // Ease-out slide (docs/16 section 8.1); a plain fade when reduced motion is on.
      Animated.timing(slide, { toValue: 1, duration: tokens.motion.sheet, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }
  }, [visible, slide]);
  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [still ? 0 : Math.min(420, height), 0] });
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.sheetRoot}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("common.close")} style={StyleSheet.absoluteFill} onPress={onClose} />
          <Animated.View style={[styles.sheet, { opacity: still ? slide : 1, maxHeight: height * 0.9, paddingBottom: Math.max(insets.bottom, tokens.space[3]) + tokens.space[2], transform: [{ translateY }] }]}>
            <View style={styles.sheetHandle} />
            <View style={[styles.row, { paddingHorizontal: tokens.space[4], paddingBottom: tokens.space[2] }]}>
              <View style={styles.grow}>
                <Text accessibilityRole="header" style={type.title}>{title}</Text>
                {subtitle ? <Text style={type.caption}>{subtitle}</Text> : null}
              </View>
              <IconButton name="close" label={t("common.close")} onPress={onClose} />
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: tokens.space[4], paddingBottom: tokens.space[3], gap: tokens.space[3] }}>
              {children}
            </ScrollView>
            {footer ? <View style={{ paddingHorizontal: tokens.space[4], paddingTop: tokens.space[2], gap: tokens.space[2] }}>{footer}</View> : null}
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Toasts and the payment-received banner (docs/04 section 11, 13.4)
// ---------------------------------------------------------------------------

export interface ToastMessage { id: number; kind: "good" | "bad" | "info" | "payment" | "manual"; title: string; body?: string; amountMinor?: number }

interface ToastState { current: ToastMessage | null; show: (toast: Omit<ToastMessage, "id">) => void; hide: () => void }

let toastSeq = 0;
export const useToast = create<ToastState>((set) => ({
  current: null,
  show: (toast) => set({ current: { ...toast, id: ++toastSeq } }),
  hide: () => set({ current: null }),
}));

export function showToast(toast: Omit<ToastMessage, "id">) {
  useToast.getState().show(toast);
}

export function ToastHost() {
  const insets = useSafeAreaInsets();
  const bangla = useBangla();
  const current = useToast((s) => s.current);
  const hide = useToast((s) => s.hide);
  const still = useReducedMotion();
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!current) return;
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: tokens.motion.standard, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    const timer = setTimeout(() => {
      Animated.timing(anim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => hide());
    }, current.kind === "payment" ? 4200 : 3000);
    return () => clearTimeout(timer);
  }, [current, anim, hide]);
  if (!current) return null;
  const payment = current.kind === "payment";
  const bg = payment || current.kind === "good" ? c.statusGood : current.kind === "bad" ? c.statusBad : current.kind === "manual" ? c.manualTag : c.brandPrimary;
  const icon: AppIconName = payment ? "arrow-in" : current.kind === "good" ? "closing" : current.kind === "bad" ? "alert" : current.kind === "manual" ? "pen" : "info";
  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.toastWrap, { top: insets.top + 8, opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [still ? 0 : -16, 0] }) }] }]}
    >
      <Pressable accessibilityRole="alert" onPress={hide} style={[styles.toast, { backgroundColor: bg }]}>
        <View style={styles.toastIcon}><AppIcon name={icon} size={22} color={c.onBrand} strokeWidth={2.2} /></View>
        <View style={styles.grow}>
          <Text style={[type.label, { color: c.onBrand }]}>{current.title}</Text>
          {current.amountMinor != null ? <MoneyText amountMinor={current.amountMinor} bangla={bangla} size="title" inverse /> : null}
          {current.body ? <Text style={[type.caption, { color: "rgba(255,255,255,0.9)" }]}>{current.body}</Text> : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------

export const styles = StyleSheet.create({
  content: { paddingHorizontal: tokens.space[4], paddingTop: tokens.space[2], gap: tokens.space[5] },
  maxWidth: { width: "100%", maxWidth: 560, alignSelf: "center", gap: tokens.space[5] },
  row: { flexDirection: "row", alignItems: "center", gap: tokens.space[2] },
  grow: { flex: 1, minWidth: 0 },
  header: { flexDirection: "row", alignItems: "center", gap: tokens.space[3], paddingHorizontal: tokens.space[4], paddingVertical: tokens.space[2], minHeight: 60 },
  bottomBar: { paddingHorizontal: tokens.space[4], paddingTop: tokens.space[3], backgroundColor: c.bg, borderTopWidth: 1, borderTopColor: c.divider },
  card: { backgroundColor: c.surface, borderRadius: tokens.radius.lg, ...tokens.shadow.card },
  cardPad: { padding: tokens.space[4], gap: tokens.space[3] },
  cardManual: { backgroundColor: c.manualTint, borderWidth: 1, borderColor: c.manualBorder, shadowOpacity: 0, elevation: 0 },
  cardAi: { backgroundColor: c.aiTint, shadowOpacity: 0, elevation: 0 },
  cardBrand: { backgroundColor: c.brandPrimary },
  pressed: { opacity: 0.92, transform: [{ scale: tokens.motion.pressScale }] },
  pressedRow: { backgroundColor: c.brandWash },
  iconButton: { width: 44, height: 44, borderRadius: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.divider, alignItems: "center", justifyContent: "center" },
  iconButtonOnBrand: { backgroundColor: "rgba(255,255,255,0.12)", borderColor: "rgba(255,255,255,0.18)" },
  badge: { position: "absolute", top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: c.statusBad, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: c.surface },
  badgeText: { color: c.onBrand, fontSize: 10, lineHeight: 13, fontWeight: "700" },
  textLink: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 2 },
  segments: { flexDirection: "row", padding: 4, borderRadius: 16, backgroundColor: c.surfaceMuted, gap: 4 },
  segment: { flex: 1, minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 8, borderRadius: 12 },
  segmentActive: { backgroundColor: c.surface, ...tokens.shadow.card },
  segmentText: { fontSize: 14, lineHeight: 21, fontWeight: "600", color: c.textMuted },
  segmentTextActive: { color: c.brandPrimary, fontWeight: "700" },
  chip: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, borderRadius: tokens.radius.pill, backgroundColor: c.surface, borderWidth: 1, borderColor: c.divider },
  chipActive: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  chipText: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: c.text },
  chipTextActive: { color: c.onBrand },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: tokens.space[2] },
  choiceCard: { flexDirection: "row", alignItems: "center", gap: tokens.space[3], padding: tokens.space[3], borderRadius: tokens.radius.md, backgroundColor: c.surface, borderWidth: 1.5, borderColor: c.divider },
  choiceCardActive: { borderColor: c.brandPrimary, backgroundColor: c.brandWash },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: c.divider, alignItems: "center", justifyContent: "center" },
  radioOn: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  inputWrap: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: tokens.space[2], paddingHorizontal: tokens.space[3], borderRadius: tokens.radius.md, borderWidth: 1.5, borderColor: c.divider, backgroundColor: c.surface },
  inputError: { borderColor: c.statusBad },
  input: { flex: 1, minHeight: 50, fontSize: 17, color: c.text, paddingVertical: 10 },
  prefix: { fontSize: 17, fontWeight: "600", color: c.textMuted, paddingRight: 6, borderRightWidth: 1, borderRightColor: c.divider },
  notice: { flexDirection: "row", gap: tokens.space[3], padding: tokens.space[3], borderRadius: tokens.radius.md },
  listRow: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: tokens.space[3], paddingVertical: tokens.space[2], paddingHorizontal: tokens.space[1], borderRadius: tokens.radius.md },
  amountRow: { flexDirection: "row", alignItems: "center", gap: tokens.space[3], minHeight: 36 },
  sourceBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, borderRadius: 6, alignSelf: "flex-start" },
  sourceText: { fontSize: 11, lineHeight: 16, fontWeight: "700" },
  grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -4 },
  feature: { minHeight: 100, alignItems: "center", justifyContent: "flex-start", gap: 8, paddingTop: 12, paddingBottom: 8, paddingHorizontal: 2, borderRadius: tokens.radius.md },
  featureLabel: { fontSize: 13, lineHeight: 18, fontWeight: "600", textAlign: "center", color: c.text },
  featureBadge: { position: "absolute", top: 6, right: 10, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: c.statusBad, alignItems: "center", justifyContent: "center" },
  state: { alignItems: "center", justifyContent: "center", gap: tokens.space[2], paddingVertical: tokens.space[6], paddingHorizontal: tokens.space[4] },
  sheetRoot: { flex: 1, justifyContent: "flex-end", backgroundColor: c.scrim },
  sheet: { backgroundColor: c.bg, borderTopLeftRadius: tokens.radius.xl, borderTopRightRadius: tokens.radius.xl, width: "100%", maxWidth: 640, alignSelf: "center" },
  sheetHandle: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: c.divider, marginTop: 8, marginBottom: 8 },
  toastWrap: { position: "absolute", left: 12, right: 12, zIndex: 50, alignItems: "center" },
  toast: { width: "100%", maxWidth: 520, flexDirection: "row", alignItems: "center", gap: tokens.space[3], padding: tokens.space[3], borderRadius: tokens.radius.lg, ...tokens.shadow.raised },
  toastIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
});
