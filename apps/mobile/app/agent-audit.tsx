import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { MoneyText, PrimaryButton, StatusPill, keypadAmountMinor, tokens } from "@bizflow/ui";
import { formatMoney } from "@bizflow/shared";
import { RoleGuard } from "../components/RoleGuard";
import { AppIcon } from "../components/AppIcon";
import { CashCounter } from "../components/CashCounter";
import { Card, Divider, ErrorState, Field, LoadingState, Notice, Screen, ScreenHeader, SourceBadge, StepHeader, type, useBangla } from "../components/kit";
import { AnimatedMoney, SuccessSheet, type SuccessInfo } from "../components/motion";
import { PostingError, useAgentAuditPreview, usePostAgentAudit } from "../lib/api";
import { feedback } from "../lib/feedback";
import { goBack } from "../lib/view";

const c = tokens.color;

/**
 * Agent day-end audit (docs/03 M9): count the drawer, confirm the upay e-float (verified),
 * enter each other wallet (manual), then see every difference before saving.
 */
function AgentAudit() {
  const { t } = useTranslation();
  const router = useRouter();
  const bangla = useBangla();
  const preview = useAgentAuditPreview();
  const post = usePostAgentAudit();
  const [step, setStep] = useState(1);
  const [cash, setCash] = useState<number | null>(null);
  const [upay, setUpay] = useState("");
  const [wallets, setWallets] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessInfo | null>(null);

  useEffect(() => {
    if (!preview.data) return;
    setUpay(String(Math.trunc(preview.data.expected_upay_minor / 100)));
    setWallets(Object.fromEntries(preview.data.wallets.map((w) => [w.wallet, String(Math.trunc(w.expected_minor / 100))])));
  }, [preview.data]);

  const header = <ScreenHeader title={t("agent.audit_title")} onBack={() => (step > 1 ? setStep(step - 1) : goBack(router))} />;
  if (preview.isLoading) return <Screen header={header}><LoadingState /></Screen>;
  if (preview.isError || !preview.data) return <Screen header={header}><ErrorState onRetry={() => void preview.refetch()} /></Screen>;
  const data = preview.data;
  if (data.already_audited && !success) return <Screen header={header}><Notice kind="good" title={t("agent.audit_done")} action={t("ux.f_history")} onAction={() => router.replace("/history")} /></Screen>;

  const upayMinor = keypadAmountMinor(upay);
  const cashVar = (cash ?? 0) - data.expected_cash_minor;
  const upayVar = upayMinor - data.expected_upay_minor;
  const walletVars = data.wallets.map((w) => ({ wallet: w.wallet, actual: keypadAmountMinor(wallets[w.wallet] ?? ""), diff: keypadAmountMinor(wallets[w.wallet] ?? "") - w.expected_minor }));
  const allMatch = cashVar === 0 && upayVar === 0 && walletVars.every((w) => w.diff === 0);

  async function save() {
    setError(null);
    try {
      await post.mutateAsync({ counted_cash_minor: cash ?? 0, actual_upay_minor: upayMinor, wallets: walletVars.map((w) => ({ wallet: w.wallet, actual_minor: w.actual })), note: note.trim() || undefined });
      setSuccess({ title: t("ux.audit_saved"), amountMinor: cash ?? 0, tone: allMatch ? "good" : "warn", detail: allMatch ? t("ux.matched") : `${t("closing.difference")}: ${formatMoney(cashVar, { bangla, currency: "taka-sign" })}` });
    } catch (e) {
      feedback("error");
      setError(t(`posting_error.${e instanceof PostingError ? e.code : "UNKNOWN"}`));
    }
  }

  const footer = step === 1 ? <PrimaryButton label={t("ux.next")} disabled={cash == null} onPress={() => setStep(2)} />
    : step === 2 ? <PrimaryButton label={t("ux.next")} disabled={!upay || data.wallets.some((w) => !wallets[w.wallet])} onPress={() => setStep(3)} />
      : <PrimaryButton label={t("agent.save_audit")} busy={post.isPending} onPress={() => void save()} />;

  return (
    <Screen header={header} footer={footer}>
      <StepHeader step={step} total={3} label={t(step === 1 ? "ux.closing_step2" : step === 2 ? "ux.e_float" : "ux.closing_step3")} />
      {step === 1 ? (
        <>
          <Card style={{ flexDirection: "row", alignItems: "center" }}>
            <AppIcon name="cash" size={22} color={c.brandPrimary} />
            <Text style={[type.label, { flex: 1 }]}>{t("agent.expected")}</Text>
            <MoneyText amountMinor={data.expected_cash_minor} bangla={bangla} size="title" />
          </Card>
          <CashCounter onChange={setCash} />
        </>
      ) : null}
      {step === 2 ? (
        <>
          <Card style={{ gap: tokens.space[2] }}>
            <View style={s.row}><Text style={[type.label, { flex: 1 }]}>{t("ux.e_float")}</Text><SourceBadge source="verified" /></View>
            <Text style={type.caption}>{t("agent.expected")}: {formatMoney(data.expected_upay_minor, { bangla, currency: "taka-sign" })}</Text>
            <Field label={t("agent.actual")} value={upay} onChangeText={(v) => setUpay(v.replace(/[^\d]/g, ""))} keyboardType="number-pad" prefix="৳" />
          </Card>
          {data.wallets.map((w) => (
            <Card key={w.wallet} tone="manual" style={{ gap: tokens.space[2] }}>
              <View style={s.row}><Text style={[type.label, { flex: 1 }]}>{w.wallet}</Text><SourceBadge source="manual" /></View>
              <Text style={type.caption}>{t("agent.expected")}: {formatMoney(w.expected_minor, { bangla, currency: "taka-sign" })}</Text>
              <Field label={t("agent.actual")} value={wallets[w.wallet] ?? ""} onChangeText={(v) => setWallets((cur) => ({ ...cur, [w.wallet]: v.replace(/[^\d]/g, "") }))} keyboardType="number-pad" prefix="৳" />
            </Card>
          ))}
        </>
      ) : null}
      {step === 3 ? (
        <>
          <Card style={{ gap: 0 }}>
            <DiffRow label={t("agent.cash_drawer")} diff={cashVar} />
            <Divider />
            <DiffRow label={t("ux.e_float")} diff={upayVar} />
            {walletVars.map((w) => <View key={w.wallet}><Divider /><DiffRow label={w.wallet} diff={w.diff} manual /></View>)}
          </Card>
          <Card style={{ flexDirection: "row", alignItems: "center" }}>
            <AppIcon name="commission" size={22} color={c.brandPrimary} />
            <Text style={[type.label, { flex: 1 }]}>{t("agent.commission_today")}</Text>
            <AnimatedMoney amountMinor={data.commission_minor} size="title" />
          </Card>
          <Field label={t("ux.note_optional")} value={note} onChangeText={setNote} maxLength={240} />
          {error ? <Notice kind="bad" title={error} /> : null}
        </>
      ) : null}
      <SuccessSheet info={success} onDone={() => goBack(router)} />
    </Screen>
  );
}

function DiffRow({ label, diff, manual }: { label: string; diff: number; manual?: boolean }) {
  const { t } = useTranslation();
  const bangla = useBangla();
  const kind = diff === 0 ? "good" : "warn";
  return (
    <View style={s.diff}>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={s.row}><Text style={type.label}>{label}</Text>{manual ? <SourceBadge source="manual" /> : null}</View>
        <StatusPill kind={kind} compact label={diff === 0 ? t("ux.matched") : diff < 0 ? t("ux.short") : t("ux.over")} />
      </View>
      <MoneyText amountMinor={diff} bangla={bangla} />
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: tokens.space[2] },
  diff: { flexDirection: "row", alignItems: "center", gap: tokens.space[3], paddingVertical: tokens.space[3] },
});

export default function AgentAuditScreen() {
  return <RoleGuard type="AGENT"><AgentAudit /></RoleGuard>;
}
