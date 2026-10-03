import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { PrimaryButton, tokens } from "@bizflow/ui";
import { AppIcon, BrandMark } from "../../components/AppIcon";
import { OtpStep, e164 } from "../../components/auth";
import { Field, IconButton, Notice, StepHeader, type } from "../../components/kit";
import { FadeIn } from "../../components/motion";
import { supabase, isDemoData } from "../../lib/supabase";
import { setDemoEntrance } from "../../lib/demo/client";
import { useSession } from "../../lib/session";
import { useAppLock } from "../../lib/pin";
import { setAppLanguage } from "../../lib/i18n";
import { feedback } from "../../lib/feedback";

const c = tokens.color;

/**
 * Sign in (docs/16 section 4): choose the door (shop or agent point), enter the number,
 * enter the SMS code. A device PIN is created right after, and later opens the app.
 */
export default function Login() {
  const insets = useSafeAreaInsets();
  const { t, i18n } = useTranslation();
  const entrance = useSession((s) => s.entrance);
  const chooseEntrance = useSession((s) => s.chooseEntrance);
  const loginError = useSession((s) => s.loginError);
  const verifying = useSession((s) => s.verifying);
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const full = e164(phone);
  const valid = /^\+8801[3-9]\d{8}$/.test(full);

  function pick(next: "MERCHANT" | "AGENT" | null) {
    chooseEntrance(next);
    setDemoEntrance(next);
    setStep("phone");
    setError(null);
  }

  async function sendCode() {
    useSession.getState().setLoginError(null);
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.auth.signInWithOtp({ phone: full });
    setBusy(false);
    if (e) {
      feedback("error");
      setError(t("auth.send_failed"));
      return;
    }
    setStep("code");
  }

  const english = i18n.language === "en";

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + tokens.space[3], paddingBottom: Math.max(insets.bottom, tokens.space[4]) + tokens.space[3], paddingHorizontal: tokens.space[4] }}>
        <View style={s.column}>
          <View style={s.topRow}>
            {entrance ? <IconButton name="back" label={t("auth.change_entrance")} onPress={() => (step === "code" ? setStep("phone") : pick(null))} /> : <BrandMark size={40} />}
            <Text style={[type.heading, { flex: 1, color: c.brandPrimary }]}>{entrance ? "" : t("app_name")}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Language" onPress={() => void setAppLanguage(english ? "bn" : "en")} style={({ pressed }) => [s.lang, pressed && { opacity: 0.7 }]}>
              <AppIcon name="language" size={18} color={c.brandPrimary} />
              <Text style={type.link}>{english ? "বাংলা" : "English"}</Text>
            </Pressable>
          </View>

          {!entrance ? (
            <FadeIn style={{ flex: 1, justifyContent: "center", gap: tokens.space[5], paddingVertical: tokens.space[5] }}>
              <View style={{ gap: tokens.space[2] }}>
                <Text accessibilityRole="header" style={[type.display, { fontSize: 28, lineHeight: 40 }]}>{t("ux.welcome_title")}</Text>
                <Text style={type.bodyMuted}>{t("ux.welcome_sub")}</Text>
              </View>
              <View style={{ gap: tokens.space[3] }}>
                <Door icon="store" title={t("ux.merchant_door")} hint={t("ux.merchant_door_hint")} onPress={() => pick("MERCHANT")} />
                <Door icon="agent" title={t("ux.agent_door")} hint={t("ux.agent_door_hint")} onPress={() => pick("AGENT")} />
              </View>
              <View style={s.trust}>
                <AppIcon name="shield" size={20} color={c.statusGood} />
                <Text style={[type.caption, { flex: 1, color: c.text }]}>{t("ux.trust_ai")}</Text>
              </View>
              {isDemoData ? <Notice kind="info" icon="info" title={t("ux.demo_banner")} body={t("ux.demo_numbers")} /> : null}
            </FadeIn>
          ) : step === "phone" ? (
            <FadeIn style={{ gap: tokens.space[4], paddingTop: tokens.space[4] }}>
              <StepHeader step={1} total={2} />
              <View style={s.doorChip}>
                <AppIcon name={entrance === "AGENT" ? "agent" : "store"} size={18} color={c.brandPrimary} />
                <Text style={type.label}>{t(entrance === "AGENT" ? "ux.agent_door" : "ux.merchant_door")}</Text>
              </View>
              <View style={{ gap: 4 }}>
                <Text accessibilityRole="header" style={type.display}>{t("ux.phone_title")}</Text>
                <Text style={type.bodyMuted}>{t("ux.phone_hint")}</Text>
              </View>
              <Field
                label={t("auth.phone_label")}
                prefix="+88"
                value={phone}
                onChangeText={(v) => { setPhone(v.slice(0, 14)); setError(null); }}
                placeholder="01XXXXXXXXX"
                keyboardType="phone-pad"
                autoComplete="tel"
                autoFocus
                error={phone.length >= 11 && !valid ? t("ux.phone_invalid") : null}
              />
              {error || loginError ? <Notice kind="bad" title={error ?? t(loginError!)} /> : null}
              <PrimaryButton label={t("auth.send_code")} busy={busy || verifying} disabled={!valid} onPress={() => void sendCode()} />
              {isDemoData ? <Text style={[type.caption, { textAlign: "center" }]}>{t("ux.demo_numbers")}</Text> : null}
              <View style={[s.trust, { backgroundColor: "transparent", justifyContent: "center" }]}>
                <AppIcon name="lock" size={16} color={c.statusGood} />
                <Text style={type.caption}>{t("auth.secure_otp")}</Text>
              </View>
            </FadeIn>
          ) : (
            <FadeIn style={{ gap: tokens.space[4], paddingTop: tokens.space[4] }}>
              <StepHeader step={2} total={2} />
              <OtpStep phone={full} onChangePhone={() => setStep("phone")} onVerified={() => useAppLock.getState().markFresh()} />
            </FadeIn>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Door({ icon, title, hint, onPress }: { icon: "store" | "agent"; title: string; hint: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPressIn={() => feedback("tap")} onPress={onPress} style={({ pressed }) => [s.door, pressed && { transform: [{ scale: tokens.motion.pressScale }], borderColor: c.brandPrimary }]}>
      <View style={s.doorIcon}><AppIcon name={icon} size={30} color={c.onBrand} /></View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={type.title}>{title}</Text>
        <Text style={type.caption}>{hint}</Text>
      </View>
      <View style={s.doorArrow}><AppIcon name="chevron" size={18} color={c.brandPrimary} strokeWidth={2.2} /></View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  column: { flex: 1, width: "100%", maxWidth: 480, alignSelf: "center" },
  topRow: { flexDirection: "row", alignItems: "center", gap: tokens.space[3], minHeight: 48 },
  lang: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, paddingHorizontal: 12, borderRadius: tokens.radius.pill, backgroundColor: c.surface, borderWidth: 1, borderColor: c.divider },
  door: { minHeight: 104, flexDirection: "row", alignItems: "center", gap: tokens.space[4], padding: tokens.space[4], borderRadius: tokens.radius.lg, backgroundColor: c.surface, borderWidth: 1.5, borderColor: c.divider, ...tokens.shadow.card },
  doorIcon: { width: 60, height: 60, borderRadius: 20, backgroundColor: c.brandPrimary, alignItems: "center", justifyContent: "center" },
  doorArrow: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.brandSoft, alignItems: "center", justifyContent: "center" },
  trust: { flexDirection: "row", alignItems: "center", gap: tokens.space[2], padding: tokens.space[3], borderRadius: tokens.radius.md, backgroundColor: c.statusGoodBg },
  doorChip: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 6, borderRadius: tokens.radius.pill, backgroundColor: c.brandSoft },
});
