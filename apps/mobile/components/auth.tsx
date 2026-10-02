/**
 * Sign-in pieces shared by the login screen and the app lock (docs/16 sections 4 and 6):
 * the PIN pad, the OTP step, PIN creation and the PIN unlock with its "Forgot PIN?" reset.
 */
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { PrimaryButton, tokens } from "@bizflow/ui";
import { AppIcon, BrandMark } from "./AppIcon";
import { Notice, TextLink, type } from "./kit";
import { feedback, useReducedMotion } from "../lib/feedback";
import { PIN_LENGTH, clearPin, pinIsWeak, setPin, useAppLock, verifyPin } from "../lib/pin";
import { supabase, isDemoData } from "../lib/supabase";
import { useActiveBusiness } from "../lib/session";

const c = tokens.color;
const BN = "০১২৩৪৫৬৭৮৯";

/** "+8801712345678" or "8801712345678" -> "01712345678", for showing to people. */
export function localPhone(phone: string | undefined | null): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.startsWith("88") ? digits.slice(2) : digits;
}

export function e164(local: string): string {
  const digits = local.replace(/[০-৯]/g, (d) => String(BN.indexOf(d))).replace(/\D/g, "");
  if (digits.startsWith("880")) return `+${digits}`;
  return `+88${digits}`;
}

// ---------------------------------------------------------------------------
// PIN dots and pad
// ---------------------------------------------------------------------------

export function PinDots({ length, error }: { length: number; error?: boolean }) {
  const still = useReducedMotion();
  const shake = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!error || still) return;
    shake.setValue(0);
    Animated.timing(shake, { toValue: 1, duration: 300, easing: Easing.linear, useNativeDriver: true }).start();
  }, [error, shake, still]);
  const translateX = shake.interpolate({ inputRange: [0, 0.2, 0.4, 0.6, 0.8, 1], outputRange: [0, -8, 8, -5, 5, 0] });
  return (
    <Animated.View accessibilityLabel={`${length} / ${PIN_LENGTH}`} style={[s.dots, { transform: [{ translateX }] }]}>
      {Array.from({ length: PIN_LENGTH }, (_, i) => (
        <View key={i} style={[s.dot, i < length && s.dotOn, error && s.dotError]} />
      ))}
    </Animated.View>
  );
}

export function PinPad({ value, onChange, onComplete, bangla }: { value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; bangla: boolean }) {
  const { t } = useTranslation();
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];
  const press = (k: string) => {
    if (k === "del") return onChange(value.slice(0, -1));
    if (value.length >= PIN_LENGTH) return;
    const next = value + k;
    onChange(next);
    if (next.length === PIN_LENGTH) onComplete?.(next);
  };
  return (
    <View style={s.pad}>
      {keys.map((k, i) =>
        k === "" ? <View key={i} style={s.key} /> : (
          <Pressable key={i} accessibilityRole="button" accessibilityLabel={k === "del" ? t("ux.delete_digit") : k} onPress={() => press(k)}
            style={({ pressed }) => [s.key, pressed && { backgroundColor: c.brandSoft, transform: [{ scale: tokens.motion.pressScale }] }]}>
            {k === "del" ? <AppIcon name="backspace" size={26} color={c.text} /> : <Text style={s.keyText}>{bangla ? BN[Number(k)] : k}</Text>}
          </Pressable>
        ),
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// OTP step
// ---------------------------------------------------------------------------

export function OtpStep({ phone, onVerified, onChangePhone }: { phone: string; onVerified: () => void; onChangePhone?: () => void }) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(30);
  const input = useRef<TextInput>(null);
  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function verify(value = code) {
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.auth.verifyOtp({ phone, token: value, type: "sms" });
    setBusy(false);
    if (e) {
      feedback("error");
      setError(t("auth.code_wrong"));
      setCode("");
      return;
    }
    feedback("security");
    onVerified();
  }
  async function resend() {
    setError(null);
    const { error: e } = await supabase.auth.signInWithOtp({ phone });
    if (e) setError(t("auth.send_failed"));
    else setWait(30);
  }

  return (
    <View style={{ gap: tokens.space[4] }}>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={type.display}>{t("ux.otp_title")}</Text>
        <Text style={type.bodyMuted}>{t("ux.otp_sent_to", { phone: localPhone(phone) })}</Text>
      </View>
      <Pressable onPress={() => input.current?.focus()} style={s.otpRow} accessibilityLabel={t("auth.code_label")}>
        {Array.from({ length: 6 }, (_, i) => (
          <View key={i} style={[s.otpBox, i === code.length && s.otpBoxActive, !!error && s.otpBoxError]}>
            <Text style={s.otpDigit}>{code[i] ?? ""}</Text>
          </View>
        ))}
        <TextInput
          ref={input}
          value={code}
          autoFocus
          onChangeText={(v) => {
            const next = v.replace(/[০-৯]/g, (d) => String(BN.indexOf(d))).replace(/\D/g, "").slice(0, 6);
            setCode(next);
            setError(null);
            if (next.length === 6) void verify(next);
          }}
          keyboardType="number-pad"
          autoComplete="sms-otp"
          textContentType="oneTimeCode"
          maxLength={6}
          style={s.hiddenInput}
        />
      </Pressable>
      {error ? <Notice kind="bad" title={error} /> : null}
      {isDemoData ? <Notice kind="info" icon="key" title={t("ux.demo_code_hint")} /> : null}
      <PrimaryButton label={t("auth.verify")} busy={busy} disabled={code.length < 6} onPress={() => void verify()} />
      <View style={s.rowBetween}>
        {wait > 0 ? <Text style={type.caption}>{t("ux.resend_wait", { seconds: wait })}</Text> : <TextLink label={t("ux.resend")} onPress={() => void resend()} />}
        {onChangePhone ? <TextLink label={t("auth.change_phone")} onPress={onChangePhone} tone="muted" /> : null}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// PIN creation (after first OTP, and after a reset)
// ---------------------------------------------------------------------------

export function PinSetup({ phone, onDone }: { phone: string; onDone: () => void }) {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const [first, setFirst] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function complete(pin: string) {
    if (!first) {
      if (pinIsWeak(pin)) {
        feedback("error");
        setError(t("ux.pin_weak"));
        setValue("");
        return;
      }
      setFirst(pin);
      setError(null);
      setValue("");
      return;
    }
    if (pin !== first) {
      feedback("error");
      setError(t("ux.pin_mismatch"));
      setFirst(null);
      setValue("");
      return;
    }
    await setPin(localPhone(phone), pin);
    feedback("security");
    onDone();
  }

  return (
    <View style={[s.full, { paddingTop: insets.top + tokens.space[5], paddingBottom: Math.max(insets.bottom, tokens.space[4]) }]}>
      <View style={s.center}>
        <View style={s.lockIcon}><AppIcon name="lock" size={30} color={c.brandPrimary} /></View>
        <Text accessibilityRole="header" style={[type.title, { textAlign: "center" }]}>{t(first ? "ux.confirm_pin_title" : "ux.set_pin_title")}</Text>
        <Text style={[type.bodyMuted, { textAlign: "center" }]}>{t("ux.set_pin_hint")}</Text>
        <PinDots length={value.length} error={!!error} />
        {error ? <Text accessibilityRole="alert" style={[type.label, { color: c.statusBad, textAlign: "center" }]}>{error}</Text> : <View style={{ height: 21 }} />}
      </View>
      <PinPad value={value} onChange={setValue} onComplete={(v) => void complete(v)} bangla={i18n.language !== "en"} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// PIN unlock with "Forgot PIN?"
// ---------------------------------------------------------------------------

export function PinLock({ phone }: { phone: string }) {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const business = useActiveBusiness();
  const setLock = useAppLock((st) => st.set);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [stage, setStage] = useState<"pin" | "reset">("pin");
  const [busy, setBusy] = useState(false);

  async function check(pin: string) {
    const result = await verifyPin(pin);
    if (result.ok) {
      feedback("security");
      setLock("unlocked");
      return;
    }
    feedback("error");
    setValue("");
    if (result.locked) {
      setLocked(true);
      setError(t("ux.pin_locked"));
    } else {
      setError(t("ux.pin_wrong", { count: result.attemptsLeft }));
    }
  }

  async function startReset() {
    setBusy(true);
    const { error: e } = await supabase.auth.signInWithOtp({ phone });
    setBusy(false);
    if (e) {
      setError(t("auth.send_failed"));
      return;
    }
    setStage("reset");
  }

  async function otherAccount() {
    await clearPin();
    await supabase.auth.signOut({ scope: "local" });
    setLock("unknown");
  }

  if (stage === "reset") {
    return (
      <View style={[s.full, { paddingTop: insets.top + tokens.space[4], paddingHorizontal: tokens.space[4] }]}>
        <View style={{ width: "100%", maxWidth: 480, alignSelf: "center", gap: tokens.space[4] }}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("ux.back")} onPress={() => setStage("pin")} style={s.back}><AppIcon name="back" color={c.brandPrimary} /></Pressable>
          <Notice kind="info" icon="key" title={t("ux.reset_pin")} body={t("ux.reset_intro")} />
          <OtpStep phone={phone} onVerified={() => { void clearPin(); setLock("needs-pin"); }} />
        </View>
      </View>
    );
  }

  return (
    <View style={[s.full, { paddingTop: insets.top + tokens.space[5], paddingBottom: Math.max(insets.bottom, tokens.space[4]) }]}>
      <View style={s.center}>
        <BrandMark size={52} />
        <Text style={[type.heading, { textAlign: "center" }]} numberOfLines={1}>{business?.name ?? t("app_name")}</Text>
        <Text style={type.caption}>{localPhone(phone)}</Text>
        <Text accessibilityRole="header" style={[type.title, { marginTop: tokens.space[3] }]}>{t("ux.pin_title")}</Text>
        <PinDots length={value.length} error={!!error} />
        <View style={{ minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: tokens.space[4] }}>
          {error ? <Text accessibilityRole="alert" style={[type.label, { color: c.statusBad, textAlign: "center" }]}>{error}</Text> : null}
        </View>
        <Pressable accessibilityRole="button" onPress={() => void startReset()} disabled={busy} style={({ pressed }) => [s.forgot, (pressed || busy) && { opacity: 0.6 }]}>
          <Text style={[type.link, { fontSize: 15 }]}>{t(locked ? "ux.reset_pin" : "ux.forgot_pin")}</Text>
          <AppIcon name="chevron" size={16} color={c.brandPrimary} strokeWidth={2.4} />
        </Pressable>
      </View>
      {locked ? (
        <View style={{ paddingHorizontal: tokens.space[4], gap: tokens.space[2] }}>
          <PrimaryButton label={t("ux.reset_pin")} busy={busy} onPress={() => void startReset()} />
          <TextLink label={t("ux.other_account")} onPress={() => void otherAccount()} tone="muted" />
        </View>
      ) : (
        <>
          <PinPad value={value} onChange={(v) => { setValue(v); if (v.length) setError(null); }} onComplete={(v) => void check(v)} bangla={i18n.language !== "en"} />
          <View style={{ alignItems: "center" }}><TextLink label={t("ux.other_account")} onPress={() => void otherAccount()} tone="muted" /></View>
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  full: { flex: 1, backgroundColor: c.bg, justifyContent: "space-between" },
  center: { alignItems: "center", gap: tokens.space[2], paddingHorizontal: tokens.space[4], paddingTop: tokens.space[4] },
  lockIcon: { width: 64, height: 64, borderRadius: 22, backgroundColor: c.brandSoft, alignItems: "center", justifyContent: "center", marginBottom: tokens.space[2] },
  dots: { flexDirection: "row", gap: 16, marginTop: tokens.space[4] },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: c.brandPrimary },
  dotOn: { backgroundColor: c.brandPrimary },
  dotError: { borderColor: c.statusBad, backgroundColor: "transparent" },
  pad: { flexDirection: "row", flexWrap: "wrap", width: "100%", maxWidth: 380, alignSelf: "center", paddingHorizontal: tokens.space[4] },
  key: { width: "33.33%", height: 64, alignItems: "center", justifyContent: "center", borderRadius: 32 },
  keyText: { fontSize: 28, lineHeight: 36, fontWeight: "500", color: c.text },
  forgot: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 44, paddingHorizontal: tokens.space[3] },
  otpRow: { flexDirection: "row", gap: 8, justifyContent: "space-between" },
  otpBox: { flex: 1, maxWidth: 54, height: 60, borderRadius: tokens.radius.md, borderWidth: 1.5, borderColor: c.divider, backgroundColor: c.surface, alignItems: "center", justifyContent: "center" },
  otpBoxActive: { borderColor: c.brandPrimary, borderWidth: 2 },
  otpBoxError: { borderColor: c.statusBad },
  otpDigit: { fontSize: 26, fontWeight: "700", color: c.text },
  hiddenInput: { position: "absolute", opacity: 0.01, width: 1, height: 1 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  back: { width: 44, height: 44, borderRadius: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.divider, alignItems: "center", justifyContent: "center" },
});
