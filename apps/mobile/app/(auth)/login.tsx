import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { PrimaryButton, tokens } from "@bizflow/ui";
import { AppIcon } from "../../components/AppIcon";
import { supabase } from "../../lib/supabase";
import { useSession } from "../../lib/session";

const DEMO_MODE = process.env.EXPO_PUBLIC_DEMO_MODE === "true";
const DEMO_CODE = "123456";
const DEMO_ACCOUNTS = [
  { key: "merchant", phone: "+8801700000001" },
  { key: "agent", phone: "+8801700000002" },
] as const;

/** Phone OTP stays familiar while the entrance and trust cues become much easier to scan. */
export default function Login() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [requestBusy, setBusy] = useState(false);
  const verifying = useSession((s) => s.verifying);
  const busy = requestBusy || verifying;
  const [error, setError] = useState<string | null>(null);
  const entrance = useSession((s) => s.entrance);
  const loginError = useSession((s) => s.loginError);
  const chooseEntrance = useSession((s) => s.chooseEntrance);
  const e164 = phone.startsWith("+") ? phone : `+88${phone.replace(/^0+/, "0")}`;
  const phoneLooksValid = /^\+8801\d{9}$/.test(e164);

  async function sendCode() {
    useSession.getState().setLoginError(null);
    setBusy(true);
    setError(null);
    const { error: otpError } = await supabase.auth.signInWithOtp({ phone: e164 });
    setBusy(false);
    if (otpError) {
      setError(t("auth.send_failed"));
      return;
    }
    setStep("code");
  }

  async function verifyCode() {
    useSession.getState().setLoginError(null);
    setBusy(true);
    setError(null);
    const { error: verifyError } = await supabase.auth.verifyOtp({ phone: e164, token: code, type: "sms" });
    setBusy(false);
    if (verifyError) setError(t("auth.code_wrong"));
  }

  async function demoLogin(demoPhone: string) {
    useSession.getState().setLoginError(null);
    setBusy(true);
    setError(null);
    const { error: otpError } = await supabase.auth.signInWithOtp({ phone: demoPhone });
    if (otpError) {
      setBusy(false);
      setError(t("auth.send_failed"));
      return;
    }
    const { error: verifyError } = await supabase.auth.verifyOtp({ phone: demoPhone, token: DEMO_CODE, type: "sms" });
    setBusy(false);
    if (verifyError) setError(t("auth.code_wrong"));
  }

  function resetEntrance() {
    chooseEntrance(null);
    setStep("phone");
    setPhone("");
    setCode("");
    setError(null);
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: tokens.color.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + tokens.space[4], paddingBottom: Math.max(insets.bottom, tokens.space[4]), paddingHorizontal: tokens.space[4] }}
      >
        <View style={{ flex: 1, width: "100%", maxWidth: 480, alignSelf: "center" }}>
          <View style={{ flexDirection: "row", alignItems: "center", minHeight: 48 }}>
            {entrance ? (
              <Pressable accessibilityRole="button" accessibilityLabel={t("auth.change_entrance")} disabled={busy} onPress={resetEntrance} style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? tokens.color.brandSoft : tokens.color.surface, borderWidth: 1, borderColor: tokens.color.divider })}>
                <Text style={{ fontSize: 24, color: tokens.color.brandPrimary }}>‹</Text>
              </Pressable>
            ) : <View style={{ width: 44 }} />}
            <Text style={{ flex: 1, textAlign: "center", color: tokens.color.brandPrimary, fontSize: tokens.font.size.body, fontWeight: "700" }}>{t("app_name")}</Text>
            <View style={{ width: 44 }} />
          </View>

          {!entrance ? (
            <EntrancePicker onChoose={chooseEntrance} />
          ) : (
            <View style={{ flex: 1, paddingTop: tokens.space[5] }}>
              <View style={{ alignItems: "center", marginBottom: tokens.space[6] }}>
                <View style={{ width: 72, height: 72, borderRadius: 24, backgroundColor: tokens.color.brandPrimary, alignItems: "center", justifyContent: "center", marginBottom: tokens.space[4] }}>
                  <AppIcon name={entrance === "AGENT" ? "agent" : "store"} color={tokens.color.surface} size={36} strokeWidth={1.6} />
                </View>
                <Text accessibilityRole="header" style={{ fontSize: 26, lineHeight: 36, fontWeight: "700", color: tokens.color.text, textAlign: "center" }}>{t(`auth.${entrance.toLowerCase()}_entrance`)}</Text>
                <Text style={{ maxWidth: 320, marginTop: tokens.space[2], color: tokens.color.textMuted, fontSize: tokens.font.size.body, lineHeight: 24, textAlign: "center" }}>{t(`auth.${entrance.toLowerCase()}_intro`)}</Text>
              </View>

              <View style={{ backgroundColor: tokens.color.surface, borderRadius: tokens.radius.lg, padding: tokens.space[4], gap: tokens.space[3], borderWidth: 1, borderColor: tokens.color.divider }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: tokens.space[2] }}>
                  <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: tokens.color.brandPrimary, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: tokens.color.surface, fontSize: 12, fontWeight: "700" }}>{step === "phone" ? "1" : "2"}</Text>
                  </View>
                  <Text style={{ color: tokens.color.text, fontSize: tokens.font.size.label, fontWeight: "700" }}>{step === "phone" ? t("auth.phone_label") : t("auth.code_label")}</Text>
                  <Text style={{ marginLeft: "auto", color: tokens.color.textMuted, fontSize: tokens.font.size.caption }}>{t("auth.step_of_two", { step: step === "phone" ? 1 : 2 })}</Text>
                </View>

                <Text style={{ color: tokens.color.textMuted, fontSize: tokens.font.size.label, lineHeight: 21 }}>{step === "phone" ? t("auth.phone_prompt") : t("auth.code_prompt", { phone: e164 })}</Text>

                {step === "phone" ? (
                  <TextInput
                    value={phone}
                    onChangeText={setPhone}
                    placeholder="01XXXXXXXXX"
                    placeholderTextColor={tokens.color.textMuted}
                    keyboardType="phone-pad"
                    autoComplete="tel"
                    accessibilityLabel={t("auth.phone_label")}
                    style={inputStyle}
                  />
                ) : (
                  <TextInput
                    value={code}
                    onChangeText={setCode}
                    placeholder="------"
                    placeholderTextColor={tokens.color.textMuted}
                    keyboardType="number-pad"
                    maxLength={6}
                    autoComplete="sms-otp"
                    accessibilityLabel={t("auth.code_label")}
                    style={[inputStyle, { letterSpacing: 8, textAlign: "center" }]}
                  />
                )}

                {error || loginError ? <Text accessibilityRole="alert" style={{ color: tokens.color.statusBad, fontSize: tokens.font.size.label, lineHeight: 21 }}>{error ?? t(loginError!)}</Text> : null}

                <PrimaryButton label={step === "phone" ? t("auth.send_code") : t("auth.verify")} busy={busy} disabled={step === "phone" ? !phoneLooksValid : code.length < 4} onPress={step === "phone" ? sendCode : verifyCode} />

                {step === "code" ? (
                  <Pressable accessibilityRole="button" disabled={busy} onPress={() => { setStep("phone"); setCode(""); setError(null); }} style={{ minHeight: 44, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: tokens.color.brandPrimary, fontSize: tokens.font.size.label, fontWeight: "600" }}>{t("auth.change_phone")}</Text>
                  </Pressable>
                ) : null}
              </View>

              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: tokens.space[2], marginTop: tokens.space[4] }}>
                <View style={{ width: 24, height: 24, borderRadius: 8, backgroundColor: tokens.color.statusGoodBg, alignItems: "center", justifyContent: "center" }}>
                  <AppIcon name="closing" color={tokens.color.statusGood} size={15} />
                </View>
                <Text style={{ color: tokens.color.textMuted, fontSize: tokens.font.size.caption }}>{t("auth.secure_otp")}</Text>
              </View>

              {DEMO_MODE ? (
                <View style={{ marginTop: tokens.space[5], gap: tokens.space[2] }}>
                  <Text style={{ fontSize: tokens.font.size.caption, color: tokens.color.textMuted, textAlign: "center" }}>{t("auth.demo_hint")}</Text>
                  {DEMO_ACCOUNTS.filter((account) => account.key === entrance.toLowerCase()).map((account) => (
                    <Pressable key={account.key} accessibilityRole="button" disabled={busy} onPress={() => demoLogin(account.phone)} style={({ pressed }) => ({ minHeight: tokens.touchMin, alignItems: "center", justifyContent: "center", borderRadius: tokens.radius.md, borderWidth: 1, borderColor: tokens.color.brandPrimary, backgroundColor: pressed ? tokens.color.brandSoft : "transparent", opacity: busy ? 0.6 : 1 })}>
                      <Text style={{ fontSize: tokens.font.size.label, fontWeight: "700", color: tokens.color.brandPrimary }}>{t(`auth.demo_${account.key}`)}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function EntrancePicker({ onChoose }: { onChoose: (entrance: "MERCHANT" | "AGENT") => void }) {
  const { t } = useTranslation();
  return (
    <View style={{ flex: 1, justifyContent: "center", paddingVertical: tokens.space[6] }}>
      <View style={{ marginBottom: tokens.space[6] }}>
        <Text accessibilityRole="header" style={{ maxWidth: 340, fontSize: 30, lineHeight: 42, fontWeight: "700", letterSpacing: -0.5, color: tokens.color.text }}>{t("auth.welcome_title")}</Text>
        <Text style={{ maxWidth: 350, marginTop: tokens.space[2], color: tokens.color.textMuted, fontSize: tokens.font.size.body, lineHeight: 25 }}>{t("auth.choose_entrance")}</Text>
      </View>

      <View style={{ gap: tokens.space[3] }}>
        <EntranceCard icon="store" title={t("auth.merchant_entrance")} description={t("auth.merchant_intro")} onPress={() => onChoose("MERCHANT")} />
        <EntranceCard icon="agent" title={t("auth.agent_entrance")} description={t("auth.agent_intro")} onPress={() => onChoose("AGENT")} />
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: tokens.space[2], marginTop: tokens.space[6], padding: tokens.space[3], borderRadius: tokens.radius.md, backgroundColor: tokens.color.brandWash }}>
        <AppIcon name="closing" color={tokens.color.statusGood} size={20} />
        <Text style={{ flex: 1, color: tokens.color.textMuted, fontSize: tokens.font.size.caption, lineHeight: 19 }}>{t("auth.trust_note")}</Text>
      </View>
    </View>
  );
}

function EntranceCard({ icon, title, description, onPress }: { icon: "store" | "agent"; title: string; description: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={({ pressed }) => ({ minHeight: 116, flexDirection: "row", alignItems: "center", gap: tokens.space[4], padding: tokens.space[4], borderRadius: tokens.radius.lg, borderWidth: 1, borderColor: pressed ? tokens.color.brandPrimary : tokens.color.divider, backgroundColor: pressed ? tokens.color.brandSoft : tokens.color.surface, transform: [{ scale: pressed ? 0.99 : 1 }] })}>
      <View style={{ width: 58, height: 58, borderRadius: 18, backgroundColor: tokens.color.brandSoft, alignItems: "center", justifyContent: "center" }}>
        <AppIcon name={icon} color={tokens.color.brandPrimary} size={30} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ color: tokens.color.text, fontSize: tokens.font.size.title, fontWeight: "700" }}>{title}</Text>
        <Text numberOfLines={2} style={{ color: tokens.color.textMuted, fontSize: tokens.font.size.label, lineHeight: 21 }}>{description}</Text>
      </View>
      <AppIcon name="chevron" color={tokens.color.brandPrimary} size={20} />
    </Pressable>
  );
}

const inputStyle = {
  height: 58,
  borderRadius: tokens.radius.md,
  borderWidth: 1,
  borderColor: tokens.color.divider,
  backgroundColor: tokens.color.bg,
  paddingHorizontal: tokens.space[4],
  fontSize: tokens.font.size.title,
  color: tokens.color.text,
} as const;
