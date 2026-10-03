import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { PrimaryButton } from "@bizflow/ui";
import { Field, IconButton, Notice, Surface, TextButton, ui } from "./Experience";
import { normalizeDigits } from "../lib/ui-preview";

interface PinAccessProps {
  preview?: boolean;
  demoPin?: string;
  initialRecovery?: boolean;
  onPinChanged?: (pin: string) => void;
  onSuccess?: () => void;
  onUseOtp?: () => void;
}

/** PIN UI boundary. Only the explicitly labelled preview validates a sample PIN locally. */
export function PinAccess({ preview = false, demoPin = "12345", initialRecovery = false, onPinChanged, onSuccess, onUseOtp }: PinAccessProps) {
  const { t } = useTranslation();
  const [stage, setStage] = useState<"login" | "phone" | "code" | "new" | "done">(initialRecovery ? "phone" : "login");
  const [phone, setPhone] = useState(preview ? "01700000001" : "");
  const [pin, setPin] = useState("");
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const [countdown, setCountdown] = useState(0);
  const phoneValid = /^(?:\+88)?01\d{9}$/.test(normalizeDigits(phone.trim()));
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown(value => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  function move(next: typeof stage) { setStage(next); setError(""); setPin(""); setCode(""); setConfirmation(""); setVisible(false); }
  function submit() {
    setError("");
    if (!preview) { setError(t(stage === "login" ? "ux.pin_pending" : "ux.recovery_pending")); return; }
    if (stage === "login") {
      if (pin !== demoPin) { setError(t("ux.pin_wrong")); return; }
      onSuccess?.();
    } else if (stage === "phone") { move("code"); setCountdown(30); }
    else if (stage === "code") {
      if (code !== "123456") { setError(t("auth.code_wrong")); return; }
      move("new");
    } else if (stage === "new") {
      if (pin !== confirmation) { setError(t("ux.pin_mismatch")); return; }
      onPinChanged?.(pin); move("done");
    }
  }

  if (stage === "done") return <Surface><Notice kind="good" title={t("ux.pin_updated")} /><PrimaryButton label={t("ux.pin_login")} onPress={() => move("login")} /></Surface>;
  return <Surface>
    <View style={ui.row}><View style={ui.grow}><Text accessibilityRole="header" style={ui.heading}>{t(stage === "login" ? "ux.pin_login" : "ux.reset_pin")}</Text>{stage !== "login" ? <Text style={ui.caption}>{t("ux.reset_intro")}</Text> : null}</View><IconButton name="lock" label={t("ux.security")} onPress={() => setError(t(preview ? "ux.pin_demo_hint" : "ux.pin_pending"))} /></View>
    {preview ? <Notice title={t("ux.preview")} body={t(stage === "code" ? "ux.demo_code" : "ux.pin_demo_hint")} /> : null}
    {stage === "login" || stage === "phone" ? <Field label={t("auth.phone_label")} value={phone} onChangeText={value => { setPhone(normalizeDigits(value)); setError(""); }} autoComplete="tel" keyboardType="phone-pad" placeholder="01XXXXXXXXX" /> : null}
    {stage === "login" || stage === "new" ? <View style={ui.row}><View style={ui.grow}><Field label={t(stage === "login" ? "ux.pin" : "ux.new_pin")} value={pin} onChangeText={value => { setPin(normalizeDigits(value).replace(/\D/g, "")); setError(""); }} secureTextEntry={!visible} keyboardType="number-pad" maxLength={5} autoComplete="off" placeholder="•••••" /></View><IconButton name={visible ? "eye-off" : "eye"} label={t(visible ? "ux.hide" : "ux.full_details")} onPress={() => setVisible(value => !value)} /></View> : null}
    {stage === "new" ? <Field label={t("ux.confirm_pin")} value={confirmation} onChangeText={value => { setConfirmation(normalizeDigits(value).replace(/\D/g, "")); setError(""); }} secureTextEntry keyboardType="number-pad" maxLength={5} autoComplete="off" /> : null}
    {stage === "code" ? <><Field label={t("auth.code_label")} value={code} onChangeText={value => { setCode(normalizeDigits(value).replace(/\D/g, "")); setError(""); }} keyboardType="number-pad" autoComplete="sms-otp" maxLength={6} /><Text style={ui.caption}>{phone}</Text>{countdown > 0 ? <Text style={ui.caption}>{t("ux.resend_wait", { seconds: countdown })}</Text> : <TextButton label={t("ux.resend")} onPress={() => { setCountdown(30); setError(""); }} />}</> : null}
    {error ? <Text accessibilityRole="alert" style={[ui.body, { color: "#A93A3A" }]}>{error}</Text> : null}
    <PrimaryButton label={t(stage === "login" ? "auth.verify" : stage === "phone" ? "auth.send_code" : stage === "new" ? "ux.reset_pin" : "ux.continue")} disabled={stage === "login" ? !phoneValid || pin.length !== 5 : stage === "phone" ? !phoneValid : stage === "code" ? code.length !== 6 : pin.length !== 5 || confirmation.length !== 5} onPress={submit} />
    {stage === "login" ? <TextButton label={t("ux.forgot_pin")} onPress={() => move("phone")} /> : <TextButton label={t("ux.back")} onPress={() => move("login")} />}
    {!preview && onUseOtp ? <TextButton label={t("ux.otp_login")} onPress={onUseOtp} /> : null}
  </Surface>;
}
