import { useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { AmountKeypad, MoneyText, PrimaryButton, keypadAmountMinor, tokens } from "@bizflow/ui";
import { RoleGuard } from "../components/RoleGuard";
import { Card, EmptyState, Field, Notice, Screen, ScreenHeader, SkeletonRows, StepHeader, type, useBangla } from "../components/kit";
import { SuccessSheet, type SuccessInfo } from "../components/motion";
import { TxnItem } from "../components/txn";
import { PostingError, usePostRefund, useTransactions, type TransactionRow } from "../lib/api";
import { promptReauth } from "../lib/reauth";
import { feedback } from "../lib/feedback";
import { goBack } from "../lib/view";

/**
 * Refund (docs/03 M16): pick the payment, say how much and why, confirm with the owner's
 * device check. The amount can never exceed the payment; the server caps it under a lock.
 */
function Refund() {
  const { t } = useTranslation();
  const router = useRouter();
  const bangla = useBangla();
  const params = useLocalSearchParams<{ txn?: string }>();
  const { data, isLoading } = useTransactions(200);
  const refund = usePostRefund();
  const refundable = useMemo(() => (data ?? []).filter((r) => (r.kind === "QR_PAYMENT" || r.kind === "CASH_SALE") && !(data ?? []).some((x) => x.reverses_txn_id === r.id)), [data]);
  const preset = refundable.find((r) => r.id === params.txn) ?? null;
  const [picked, setPicked] = useState<TransactionRow | null>(null);
  const selected = picked ?? preset;
  const [amount, setAmount] = useState(preset ? String(Math.trunc(Number(preset.amount_minor) / 100)) : "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessInfo | null>(null);
  const uuid = useRef(globalThis.crypto.randomUUID());
  const minor = keypadAmountMinor(amount);

  async function submit() {
    if (!selected) return;
    setError(null);
    const auth = await promptReauth(t("reauth.title"));
    if (!auth.success) { setError(t("reauth.failed")); return; }
    try {
      await refund.mutateAsync({ original_transaction_id: selected.id, amount_minor: minor, reason: reason.trim(), client_uuid: uuid.current });
      setSuccess({ title: t("refund.title"), amountMinor: minor, sign: "out", source: selected.source, detail: reason.trim() });
    } catch (e) {
      feedback("error");
      setError(t(`posting_error.${e instanceof PostingError ? e.code : "UNKNOWN"}`));
      uuid.current = globalThis.crypto.randomUUID();
    }
  }

  return (
    <Screen
      header={<ScreenHeader title={t("refund.title")} onBack={() => (selected ? (setPicked(null), router.setParams({ txn: undefined })) : goBack(router))} />}
      footer={selected ? <PrimaryButton label={t("refund.confirm")} busy={refund.isPending} disabled={minor <= 0 || minor > Number(selected.amount_minor) || reason.trim().length < 3} onPress={() => void submit()} /> : undefined}
    >
      <StepHeader step={selected ? 2 : 1} total={2} label={selected ? t("refund.how_much") : t("refund.which")} />
      {!selected ? (
        isLoading ? <SkeletonRows /> : refundable.length === 0 ? <EmptyState icon="refund" title={t("empty.transactions")} /> : (
          <View style={{ gap: 6 }}>
            {refundable.slice(0, 40).map((row) => <TxnItem key={row.id} row={row} onPress={(r) => { setPicked(r); setAmount(String(Math.trunc(Number(r.amount_minor) / 100))); }} />)}
          </View>
        )
      ) : (
        <>
          <Card>
            <Text style={type.caption}>{t("refund.refunding")}</Text>
            <MoneyText amountMinor={Number(selected.amount_minor)} bangla={bangla} size="title" />
          </Card>
          <AmountKeypad value={amount} onChange={setAmount} bangla={bangla} compact />
          {minor > Number(selected.amount_minor) ? <Notice kind="bad" title={t("posting_error.AMOUNT_INVALID")} /> : null}
          <Field label={t("refund.reason")} value={reason} onChangeText={setReason} maxLength={240} />
          {error ? <Notice kind="bad" title={error} /> : null}
          <Text style={[type.caption, { color: tokens.color.textMuted }]}>{t("reauth.body")}</Text>
        </>
      )}
      <SuccessSheet info={success} onDone={() => goBack(router)} />
    </Screen>
  );
}

export default function RefundScreen() {
  return <RoleGuard type="MERCHANT"><Refund /></RoleGuard>;
}
