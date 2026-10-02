/**
 * The few purposeful animations BizFlow has (docs/16 section 8): an amount that eases to
 * its new value, the success confirmation after money moves, and a one-time fade-in.
 * Anything not built from these does not animate.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";
import { moneyAccessibilityLabel } from "@bizflow/shared";
import { MoneyText, PrimaryButton, tokens, type MoneySize } from "@bizflow/ui";
import { AppIcon } from "./AppIcon";
import { SourceBadge, type, useBangla } from "./kit";
import { feedback, useReducedMotion } from "../lib/feedback";

const c = tokens.color;

/**
 * A money figure that eases from its old value to its new one in 220 ms, so the owner sees
 * "my balance changed because of this". Used for the few figures that matter (balance
 * hero, entry amount, today's sales, commission, closing difference), never for list rows.
 * The accessibility label always carries the final amount, never an in-between value.
 */
export function AnimatedMoney({ amountMinor, size = "body", inverse, muted, signed, style }: { amountMinor: number; size?: MoneySize; inverse?: boolean; muted?: boolean; signed?: "in" | "out"; style?: React.ComponentProps<typeof MoneyText>["style"] }) {
  const bangla = useBangla();
  const still = useReducedMotion();
  const [shown, setShown] = useState(amountMinor);
  const from = useRef(amountMinor);
  useEffect(() => {
    const start = from.current;
    const end = amountMinor;
    if (start === end || still) {
      from.current = end;
      setShown(end);
      return;
    }
    let frame = 0;
    const began = Date.now();
    const tick = () => {
      const t = Math.min(1, (Date.now() - began) / tokens.motion.standard);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      // Whole taka while moving, so digits never flicker through paisa.
      const value = t === 1 ? end : Math.round((start + (end - start) * eased) / 100) * 100;
      setShown(value);
      if (t < 1) frame = requestAnimationFrame(tick);
      else from.current = end;
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); from.current = end; };
  }, [amountMinor, still]);
  return <MoneyText amountMinor={shown} accessibilityLabel={moneyAccessibilityLabel(amountMinor)} size={size} inverse={inverse} muted={muted} signed={signed} bangla={bangla} style={style} />;
}

/** A single gentle entrance: fade plus a small rise. Used once when content first appears. */
export function FadeIn({ children, delay = 0, style }: { children: ReactNode; delay?: number; style?: StyleProp<ViewStyle> }) {
  const still = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: tokens.motion.standard, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [v, delay]);
  return (
    <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [still ? 0 : 6, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

export interface SuccessInfo {
  title: string;
  amountMinor?: number;
  /** "in" shows +, "out" shows -; omit for neutral figures such as a counted drawer. */
  sign?: "in" | "out";
  source?: "verified" | "manual";
  /** One short line under the amount, e.g. "bKash" or the customer's name. */
  detail?: string;
  /** Status word for results that are not plain success, e.g. a closing difference. */
  tone?: "good" | "warn";
}

/**
 * The confirmation after money moves (docs/16 section 8.2): the check appears with a small
 * scale, the amount fades and rises into place, the source badge stays visible, all inside
 * ~600 ms. No confetti: this is a ledger, not a game.
 */
export function SuccessSheet({ info, onDone, doneLabel, secondary }: { info: SuccessInfo | null; onDone: () => void; doneLabel?: string; secondary?: { label: string; onPress: () => void } }) {
  const { t } = useTranslation();
  const still = useReducedMotion();
  const check = useRef(new Animated.Value(0)).current;
  const body = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!info) return;
    feedback(info.tone === "warn" ? "error" : "success");
    check.setValue(0);
    body.setValue(0);
    Animated.sequence([
      still
        ? Animated.timing(check, { toValue: 1, duration: 120, useNativeDriver: true })
        : Animated.spring(check, { toValue: 1, useNativeDriver: true, damping: 14, stiffness: 260, mass: 0.7 }),
      Animated.timing(body, { toValue: 1, duration: tokens.motion.standard, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [info, check, body, still]);
  if (!info) return null;
  const warn = info.tone === "warn";
  const fg = warn ? c.statusWarn : c.statusGood;
  const bg = warn ? c.statusWarnBg : c.statusGoodBg;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onDone} statusBarTranslucent>
      <View style={s.root}>
        <View style={s.card} accessibilityRole="alert" accessibilityLiveRegion="polite">
          <Animated.View style={[s.check, { backgroundColor: bg, opacity: check, transform: [{ scale: check.interpolate({ inputRange: [0, 1], outputRange: [still ? 1 : 0.6, 1] }) }] }]}>
            <AppIcon name={warn ? "alert" : "check"} size={34} color={fg} strokeWidth={2.6} />
          </Animated.View>
          <Animated.View style={{ alignItems: "center", gap: 6, opacity: body, transform: [{ translateY: body.interpolate({ inputRange: [0, 1], outputRange: [still ? 0 : 8, 0] }) }] }}>
            <Text style={[type.title, { textAlign: "center" }]}>{info.title}</Text>
            {info.amountMinor != null ? <AnimatedMoney amountMinor={info.amountMinor} size="numberLg" signed={info.sign} /> : null}
            {info.detail ? <Text style={[type.bodyMuted, { textAlign: "center" }]}>{info.detail}</Text> : null}
            {info.source ? <SourceBadge source={info.source} compact={false} /> : null}
            {info.source === "manual" ? <Text style={[type.caption, { textAlign: "center", maxWidth: 260 }]}>{t("ux.manual_saved_note")}</Text> : null}
          </Animated.View>
          <View style={{ alignSelf: "stretch", gap: 4, marginTop: 8 }}>
            <PrimaryButton label={doneLabel ?? t("ux.done_ok")} onPress={onDone} />
            {secondary ? (
              <Pressable accessibilityRole="button" onPress={secondary.onPress} style={s.secondary}>
                <Text style={type.link}>{secondary.label}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.scrim, alignItems: "center", justifyContent: "flex-end", padding: tokens.space[4] },
  card: { width: "100%", maxWidth: 440, backgroundColor: c.surface, borderRadius: tokens.radius.xl, padding: tokens.space[5], paddingTop: tokens.space[6], alignItems: "center", gap: tokens.space[3], marginBottom: tokens.space[4], ...tokens.shadow.raised },
  check: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center" },
  secondary: { minHeight: 48, alignItems: "center", justifyContent: "center" },
});
