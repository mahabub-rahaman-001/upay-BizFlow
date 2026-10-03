import { useState } from "react";
import { Pressable, Share, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import QRCode from "react-native-qrcode-svg";
import { AmountKeypad, MoneyText, PrimaryButton, keypadAmountMinor, tokens } from "@bizflow/ui";
import { formatMoney } from "@bizflow/shared";
import { AppIcon, BrandMark } from "../../components/AppIcon";
import { Sheet, Skeleton, type, useBangla } from "../../components/kit";
import { SuccessSheet, type SuccessInfo } from "../../components/motion";
import { useBusinessQr, useSimulatePayment } from "../../lib/api";
import { isDemoData } from "../../lib/supabase";
import { feedback } from "../../lib/feedback";

const c = tokens.color;
const APPS = ["bKash", "Nagad", "Rocket", "upay"];

/**
 * Receive money (docs/04 13.3, docs/16 section 4): the QR is the hero, the verified shop
 * name sits right under it, and "any app" is said plainly. Asking for an amount is an
 * option in a sheet, never a blocker. Nothing else competes on this screen.
 */
export default function Receive() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const bangla = useBangla();
  const [amount, setAmount] = useState("");
  const [draft, setDraft] = useState("");
  const [asking, setAsking] = useState(false);
  const [success, setSuccess] = useState<SuccessInfo | null>(null);
  const amountMinor = keypadAmountMinor(amount) || undefined;
  const qr = useBusinessQr(amountMinor);
  const simulate = useSimulatePayment();

  async function share() {
    const name = qr.data?.business_name ?? "";
    const line = amountMinor ? ` · ${formatMoney(amountMinor, { currency: "Tk" })}` : "";
    await Share.share({ message: `${name}${line}\n${qr.data?.payload ?? ""}` }).catch(() => undefined);
  }

  async function samplePayment() {
    const app = APPS[Math.floor(Math.random() * APPS.length)]!;
    const value = amountMinor ?? (Math.floor(Math.random() * 18) + 2) * 5000;
    try {
      await simulate.mutateAsync({ amount_minor: value, payer_app: app });
      setSuccess({ title: t("ux.payment_received"), amountMinor: value, sign: "in", source: "verified", detail: t("ux.from_app", { app }) });
      setAmount("");
    } catch {
      feedback("error");
    }
  }

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.top}>
        <Text accessibilityRole="header" style={[type.title, { color: c.onBrand }]}>{t("ux.receive_title")}</Text>
        <Text style={[type.caption, { color: c.onBrandMuted }]}>{t("ux.receive_hint")}</Text>
      </View>

      <View style={s.card}>
        <View style={s.qrWrap}>
          {qr.isLoading ? <Skeleton width={220} height={220} radius={16} /> : qr.isError || !qr.data ? (
            <View style={s.qrError}><AppIcon name="alert" size={30} color={c.statusBad} /><Text style={[type.label, { textAlign: "center", color: c.statusBad }]}>{t("receive.no_qr")}</Text></View>
          ) : (
            <QRCode value={qr.data.payload} size={220} color={c.text} backgroundColor={c.surface} />
          )}
          <View style={s.qrLogo}><BrandMark size={34} /></View>
        </View>
        <View style={s.nameRow}>
          <Text numberOfLines={1} style={[type.heading, { flexShrink: 1 }]}>{qr.data?.business_name ?? " "}</Text>
          {qr.data?.verified ? <AppIcon name="verified" size={20} color={c.verified} /> : null}
        </View>
        {qr.data?.account_ref ? <Text style={type.caption}>{qr.data.account_ref}</Text> : null}
        {amountMinor ? (
          <View style={s.amountTag}>
            <Text style={type.caption}>{t("ux.amount_set")}</Text>
            <MoneyText amountMinor={amountMinor} bangla={bangla} size="title" />
          </View>
        ) : null}
        <View style={s.apps}>
          {APPS.map((app) => <View key={app} style={s.appChip}><Text style={[type.caption, { color: c.text, fontWeight: "600" }]}>{app}</Text></View>)}
        </View>
      </View>

      <View style={[s.actions, { paddingBottom: tokens.space[4] }]}>
        <View style={{ flexDirection: "row", gap: tokens.space[2] }}>
          <Action icon="taka" label={amountMinor ? t("ux.clear_amount") : t("ux.set_amount")} onPress={() => (amountMinor ? setAmount("") : (setDraft(""), setAsking(true)))} />
          <Action icon="share" label={t("ux.share_qr")} onPress={() => void share()} />
        </View>
        {isDemoData ? <PrimaryButton label={t("ux.test_payment")} busy={simulate.isPending} onPress={() => void samplePayment()} /> : null}
      </View>

      <Sheet
        visible={asking}
        onClose={() => setAsking(false)}
        title={t("ux.set_amount")}
        footer={<PrimaryButton label={t("ux.continue")} disabled={keypadAmountMinor(draft) <= 0} onPress={() => { setAmount(draft); setAsking(false); }} />}
      >
        <AmountKeypad value={draft} onChange={setDraft} bangla={bangla} compact />
      </Sheet>
      <SuccessSheet info={success} onDone={() => setSuccess(null)} />
    </View>
  );
}

function Action({ icon, label, onPress }: { icon: "taka" | "share"; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [s.action, pressed && { transform: [{ scale: tokens.motion.pressScale }], opacity: 0.85 }]}>
      <AppIcon name={icon} size={20} color={c.brandPrimary} />
      <Text numberOfLines={1} style={type.link}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.brandPrimary },
  top: { alignItems: "center", gap: 2, paddingTop: tokens.space[4], paddingBottom: tokens.space[4] },
  card: { marginHorizontal: tokens.space[4], padding: tokens.space[5], borderRadius: tokens.radius.xl, backgroundColor: c.surface, alignItems: "center", gap: tokens.space[2], width: "auto", maxWidth: 480, alignSelf: "stretch", ...tokens.shadow.raised },
  qrWrap: { padding: 10, borderRadius: 20, borderWidth: 2, borderColor: c.brandSoft, alignItems: "center", justifyContent: "center" },
  qrLogo: { position: "absolute", padding: 4, borderRadius: 14, backgroundColor: c.surface },
  qrError: { width: 220, height: 220, alignItems: "center", justifyContent: "center", gap: 8, padding: 16 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: tokens.space[2] },
  amountTag: { alignItems: "center", paddingHorizontal: tokens.space[4], paddingVertical: tokens.space[2], borderRadius: tokens.radius.md, backgroundColor: c.brandWash },
  apps: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 6, marginTop: tokens.space[1] },
  appChip: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: tokens.radius.pill, backgroundColor: c.surfaceMuted },
  actions: { marginTop: "auto", padding: tokens.space[4], gap: tokens.space[3], backgroundColor: c.bg, borderTopLeftRadius: tokens.radius.xl, borderTopRightRadius: tokens.radius.xl },
  action: { flex: 1, minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: tokens.radius.md, backgroundColor: c.surface, borderWidth: 1, borderColor: c.divider },
});
