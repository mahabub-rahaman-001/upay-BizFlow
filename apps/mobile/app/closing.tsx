import { useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { PrimaryButton, StatusPill, tokens } from "@bizflow/ui";
import { formatMoney } from "@bizflow/shared";
import { RoleGuard } from "../components/RoleGuard";
import { AppIcon } from "../components/AppIcon";
import { CashCounter } from "../components/CashCounter";
import { AmountRow, Card, Divider, ErrorState, Field, LoadingState, Notice, Screen, ScreenHeader, StepHeader, type, useBangla } from "../components/kit";
import { AnimatedMoney, SuccessSheet, type SuccessInfo } from "../components/motion";
import { PostingError, useClosingPreview, usePostClosing } from "../lib/api";
import { feedback } from "../lib/feedback";
import { goBack } from "../lib/view";

const c = tokens.color;
const CASH_KINDS = ["CASH_SALE", "BAKI_COLLECTION", "EXPENSE", "SUPPLIER_PAYMENT", "OWNER_WITHDRAWAL", "OWNER_DEPOSIT", "REFUND", "REVERSAL"];

/**
 * Daily closing (docs/04 13.6) in three short steps: what the day did, count the drawer,
 * match and close. The difference is said in a word and a colour, and a blocker is stated
 * before the button, never after. The variance posts to Cash over/short.
 */
function Closing() {
  const { t } = useTranslation();
  const router = useRouter();
  const bangla = useBangla();
  const preview = useClosingPreview();
  const post = usePostClosing();
  const [step, setStep] = useState(1);
  const [counted, setCounted] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [exception, setException] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessInfo | null>(null);
  const clientUuid = useRef(globalThis.crypto.randomUUID());

  if (preview.isLoading) return <Screen header={<ScreenHeader title={t("closing.title")} onBack={() => goBack(router)} />}><LoadingState /></Screen>;
  if (preview.isError || !preview.data) return <Screen header={<ScreenHeader title={t("closing.title")} onBack={() => goBack(router)} />}><ErrorState onRetry={() => void preview.refetch()} /></Screen>;

  const data = preview.data as typeof preview.data & { cash_lines?: Record<string, number>; opening_cash_minor?: number };
  const expected = Number(data.expected_cash_minor);
  const tolerance = Number(data.tolerance_minor ?? 10000);
  const variance = (counted ?? 0) - expected;
  const kind = variance === 0 ? "good" : Math.abs(variance) <= tolerance ? "warn" : "bad";
  const word = variance === 0 ? t("ux.matched") : variance < 0 ? t("ux.short") : t("ux.over");
  const blockers = data.blockers ?? [];
  const lines = data.cash_lines ?? Object.fromEntries(Object.entries(data.lines ?? {}).filter(([k]) => CASH_KINDS.includes(k)));

  async function close() {
    setError(null);
    try {
      await post.mutateAsync({ counted_cash_minor: counted ?? 0, client_uuid: clientUuid.current, note: note.trim() || undefined, exception_reason: exception.trim() || undefined });
      setSuccess({ title: t("ux.closed_title"), amountMinor: counted ?? 0, source: "manual", tone: variance === 0 ? "good" : "warn", detail: `${t("closing.difference")}: ${variance === 0 ? t("ux.matched") : formatMoney(variance, { bangla, currency: "taka-sign" })}` });
    } catch (e) {
      feedback("error");
      setError(t(`posting_error.${e instanceof PostingError ? e.code : "UNKNOWN"}`));
      clientUuid.current = globalThis.crypto.randomUUID();
    }
  }

  if (data.already_closed && !success) {
    return (
      <Screen header={<ScreenHeader title={t("closing.title")} onBack={() => goBack(router)} />}>
        <Notice kind="good" title={t("ux.closing_done")} body={t("history.merchant_hint")} action={t("ux.see_all")} onAction={() => router.replace("/history")} />
      </Screen>
    );
  }

  const footer = step === 1
    ? <PrimaryButton label={t("ux.next")} onPress={() => setStep(2)} />
    : step === 2
      ? <PrimaryButton label={t("ux.next")} disabled={counted == null} onPress={() => setStep(3)} />
      : <PrimaryButton label={t("closing.close")} busy={post.isPending} disabled={counted == null || (blockers.length > 0 && !exception.trim())} onPress={() => void close()} />;

  return (
    <Screen header={<ScreenHeader title={t("closing.title")} subtitle={data.period_date} onBack={() => (step > 1 ? setStep(step - 1) : goBack(router))} />} footer={footer}>
      <StepHeader step={step} total={3} label={t(step === 1 ? "ux.closing_step1" : step === 2 ? "ux.closing_step2" : "ux.closing_step3")} />

      {step === 1 ? (
        <Card style={{ gap: 4 }}>
          {data.opening_cash_minor != null ? <AmountRow label={t("ux.opening_cash")} amount={data.opening_cash_minor} /> : null}
          {Object.entries(lines).map(([k, v]) => (
            <AmountRow key={k} label={t(`txn_kind.${k}`, { defaultValue: k })} amount={Math.abs(Number(v))} sign={Number(v) >= 0 ? "in" : "out"} />
          ))}
          <Divider />
          <AmountRow label={t("closing.expected")} amount={expected} strong />
          {data.lines?.QR_PAYMENT ? <Text style={type.caption}>{t("txn_kind.QR_PAYMENT")}: {formatMoney(Number(data.lines.QR_PAYMENT), { bangla, currency: "taka-sign" })} · {t("ux.digital_wallet")}</Text> : null}
        </Card>
      ) : null}

      {step === 2 ? (
        <>
          <Text style={type.bodyMuted}>{t("ux.count_help")}</Text>
          <CashCounter onChange={setCounted} />
        </>
      ) : null}

      {step === 3 ? (
        <>
          <View style={s.compare}>
            <View style={s.cell}><Text style={type.caption}>{t("closing.expected")}</Text><AnimatedMoney amountMinor={expected} size="title" /></View>
            <View style={s.vr} />
            <View style={s.cell}><Text style={type.caption}>{t("closing.counted")}</Text><AnimatedMoney amountMinor={counted ?? 0} size="title" /></View>
          </View>
          <Card style={{ alignItems: "center", gap: 6 }}>
            <Text style={type.caption}>{t("closing.difference")}</Text>
            <AnimatedMoney amountMinor={variance} size="numberLg" />
            <StatusPill kind={kind} icon={<AppIcon name={variance === 0 ? "check" : "alert"} size={14} color={kind === "good" ? c.statusGood : kind === "warn" ? c.statusWarn : c.statusBad} strokeWidth={2.4} />} label={word} />
          </Card>
          <Field label={t("closing.note")} value={note} onChangeText={setNote} maxLength={240} placeholder={variance !== 0 ? t("ux.note_optional") : undefined} />
          {blockers.length > 0 ? (
            <View style={{ gap: tokens.space[2] }}>
              <Notice kind="warn" title={t("closing.blockers", { count: blockers.length })} body={blockers.map((b) => `${formatMoney(b.amount_minor, { bangla, currency: "taka-sign" })} · ${b.reason}`).join("\n")} action={t("review.title")} onAction={() => router.push("/review")} />
              <Field label={t("closing.exception_reason")} value={exception} onChangeText={setException} maxLength={240} />
            </View>
          ) : null}
          {error ? <Notice kind="bad" title={error} /> : null}
        </>
      ) : null}

      <SuccessSheet info={success} onDone={() => goBack(router)} secondary={{ label: t("history.title"), onPress: () => router.replace("/history") }} />
    </Screen>
  );
}

const s = StyleSheet.create({
  compare: { flexDirection: "row", padding: tokens.space[4], borderRadius: tokens.radius.lg, backgroundColor: c.surface, ...tokens.shadow.card },
  cell: { flex: 1, gap: 2 },
  vr: { width: 1, backgroundColor: c.divider, marginHorizontal: tokens.space[3] },
});

export default function ClosingScreen() {
  return <RoleGuard type="MERCHANT"><Closing /></RoleGuard>;
}
