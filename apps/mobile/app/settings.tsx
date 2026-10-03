import { useEffect, useState } from "react";
import { Linking, StyleSheet, Switch, Text, View } from "react-native";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { PrimaryButton, tokens } from "@bizflow/ui";
import { AppIcon } from "../components/AppIcon";
import { PinDots, PinPad, localPhone } from "../components/auth";
import { Card, Divider, ListRow, Notice, Screen, ScreenHeader, Section, Segmented, Sheet, showToast, type, useBangla, useDigits } from "../components/kit";
import { setAppLanguage, type AppLanguage } from "../lib/i18n";
import { useActiveBusiness, useIsOwner } from "../lib/session";
import { supabase, isDemoData } from "../lib/supabase";
import { resetDemoData } from "../lib/demo/client";
import { clearPin, useAppLock, verifyPin } from "../lib/pin";
import { feedback, useFeedbackSettings } from "../lib/feedback";
import { goBack } from "../lib/view";

const c = tokens.color;
const UPAY_HELP_URL = "https://www.upaybd.com/need-help";

/** Profile and settings (docs/16 section 4): who, security, preferences, records, help. */
export default function SettingsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation();
  const bangla = useBangla();
  const digits = useDigits();
  const active = useActiveBusiness();
  const isOwner = useIsOwner();
  const setLock = useAppLock((s) => s.set);
  const sound = useFeedbackSettings((s) => s.sound);
  const haptics = useFeedbackSettings((s) => s.haptics);
  const setSound = useFeedbackSettings((s) => s.setSound);
  const setHaptics = useFeedbackSettings((s) => s.setHaptics);
  const [phone, setPhone] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const language: AppLanguage = i18n.language === "en" ? "en" : "bn";
  const isAgent = active?.type === "AGENT";

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setPhone(localPhone(data.session?.user.phone) || ""));
  }, []);

  async function checkPin(value: string) {
    const result = await verifyPin(value);
    setPin("");
    if (result.ok) {
      setChanging(false);
      await clearPin();
      setLock("needs-pin");
      return;
    }
    feedback("error");
    setPinError(result.locked ? t("ux.pin_locked") : t("ux.pin_wrong", { count: result.attemptsLeft }));
    if (result.locked) { setChanging(false); setLock("locked"); }
  }

  async function logout() {
    setBusy(true);
    await clearPin();
    await supabase.auth.signOut({ scope: "local" });
    setBusy(false);
  }

  return (
    <Screen header={<ScreenHeader title={t("settings.title")} onBack={() => goBack(router)} />}>
      <Card style={{ flexDirection: "row", alignItems: "center", gap: tokens.space[3] }}>
        <View style={s.avatar}><AppIcon name={isAgent ? "agent" : "store"} size={28} color={c.onBrand} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={s.row}><Text numberOfLines={1} style={[type.heading, { flexShrink: 1 }]}>{active?.name}</Text>{active?.verified ? <AppIcon name="verified" size={18} color={c.verified} /> : null}</View>
          <Text style={type.caption}>{t(isAgent ? "settings.agent" : "settings.merchant")} · {digits(phone ?? "")}</Text>
          <Text style={type.caption}>{t("settings.upay_reference")}: {active?.upay_account_ref || t("settings.not_issued")}</Text>
        </View>
      </Card>

      <Section title={t("ux.security")}>
        <Card padded={false} style={{ paddingHorizontal: tokens.space[2] }}>
          <ListRow icon="key" title={t("ux.change_pin")} onPress={() => { setPinError(null); setPin(""); setChanging(true); }} />
          <Divider inset={52} />
          <ListRow icon="lock" title={t("ux.lock_app")} onPress={() => { feedback("security"); setLock("locked"); }} />
        </Card>
      </Section>

      <Section title={t("ux.preferences")}>
        <Card>
          <Text style={type.label}>{t("settings.language")}</Text>
          <Segmented value={language} onChange={(l) => void setAppLanguage(l).catch(() => showToast({ kind: "bad", title: t("settings.language_error") }))} items={[{ key: "bn", label: "বাংলা" }, { key: "en", label: "English" }]} />
          <Divider />
          <Toggle icon="volume" title={t("ux.sound")} hint={t("ux.sound_hint")} value={sound} onChange={(v) => { setSound(v); if (v) feedback("success"); }} />
          <Divider />
          <Toggle icon="digital" title={t("ux.haptics")} hint={t("ux.haptics_hint")} value={haptics} onChange={(v) => { setHaptics(v); if (v) feedback("tap"); }} />
        </Card>
      </Section>

      <Section title={t("ux.records")}>
        <Card padded={false} style={{ paddingHorizontal: tokens.space[2] }}>
          {isOwner && !isAgent ? <><ListRow icon="reports" title={t("reports.title")} subtitle={t("reports.settings_hint")} onPress={() => router.push("/reports")} /><Divider inset={52} /></> : null}
          <ListRow icon="history" title={t("history.title")} subtitle={t(isAgent ? "history.agent_hint" : "history.merchant_hint")} onPress={() => router.push("/history")} />
          <Divider inset={52} />
          <ListRow icon="bell" title={t("ux.notifications")} onPress={() => router.push("/notifications")} />
        </Card>
      </Section>

      <Section title={t("ux.help")}>
        <Card padded={false} style={{ paddingHorizontal: tokens.space[2] }}>
          <ListRow icon="help" title={t("settings.support")} subtitle={t("settings.support_hint")} onPress={() => void Linking.openURL(UPAY_HELP_URL).catch(() => showToast({ kind: "bad", title: t("settings.support_error") }))} />
          {isDemoData ? <><Divider inset={52} /><ListRow icon="refresh" tone="warn" title={t("ux.restart_demo")} onPress={() => void resetDemoData().then(() => { void queryClient.invalidateQueries(); showToast({ kind: "info", title: t("ux.restart_done") }); })} /></> : null}
        </Card>
      </Section>

      <PrimaryButton variant="danger" label={t("settings.logout")} icon={<AppIcon name="logout" size={18} color={c.statusBad} />} busy={busy} onPress={() => void logout()} />
      <Text style={[type.caption, { textAlign: "center" }]}>{t("app_name")} · {t("settings.app_version")} {Constants.expoConfig?.version ?? "0.1.0"}</Text>

      <Sheet visible={changing} onClose={() => setChanging(false)} title={t("ux.change_pin")} subtitle={t("ux.pin_title")}>
        <View style={{ alignItems: "center", gap: tokens.space[2] }}>
          <PinDots length={pin.length} error={!!pinError} />
          {pinError ? <Notice kind="bad" title={pinError} /> : null}
        </View>
        <PinPad value={pin} onChange={(v) => { setPin(v); setPinError(null); }} onComplete={(v) => void checkPin(v)} bangla={bangla} />
      </Sheet>
    </Screen>
  );
}

function Toggle({ icon, title, hint, value, onChange }: { icon: "volume" | "digital"; title: string; hint: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={[s.row, { minHeight: 56 }]}>
      <AppIcon name={icon} size={22} color={c.brandPrimary} />
      <View style={{ flex: 1 }}><Text style={type.label}>{title}</Text><Text style={type.caption}>{hint}</Text></View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: c.brandPrimary, false: c.divider }} accessibilityLabel={title} />
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: tokens.space[2] },
  avatar: { width: 60, height: 60, borderRadius: 20, backgroundColor: c.brandPrimary, alignItems: "center", justifyContent: "center" },
});
