import { RoleGuard } from "../components/RoleGuard";
import { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { AmountKeypad, Card, MoneyText, PrimaryButton, keypadAmountMinor, tokens } from "@bizflow/ui";
import { PostingError, usePostRefund, useTransactions, type TransactionRow } from "../lib/api";
import { promptReauth } from "../lib/reauth";

/**
 * Refund (docs/07 section 11). The owner picks a recent sale or payment, enters how much to
 * return and why, and the refund posts against it. The amount cannot exceed the payment -
 * the RPC caps it under a row lock - and a reason is required, because a refund is money
 * leaving the shop and the audit trail should say why.
 *
 * Owner only; the RPC enforces that.
 */
function Refund() {
  const insets = useSafeAreaInsets();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const bangla = i18n.language === "bn";

  const { data: transactions, isLoading } = useTransactions(50);
  const refund = usePostRefund();
  const [selected, setSelected] = useState<TransactionRow | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const clientUuid = useRef(globalThis.crypto.randomUUID());

  // Only sales and QR payments can be refunded.
  const refundable = useMemo(
    () => (transactions ?? []).filter(
      (txn) => (txn.kind === "QR_PAYMENT" || txn.kind === "CASH_SALE") && !txn.reverses_txn_id,
    ),
    [transactions],
  );

  async function submit() {
    if (!selected) return;
    const minor = keypadAmountMinor(amount);
    if (minor <= 0) return;
    setError(null);
    const auth = await promptReauth(t("refund.reauth_prompt", { defaultValue: "Authorize refund with PIN or biometric" }));
    if (!auth.success) {
      setError(auth.error ?? "Authentication failed");
      return;
    }
    try {
      await refund.mutateAsync({
        original_transaction_id: selected.id,
        amount_minor: minor,
        reason: reason.trim(),
        client_uuid: clientUuid.current,
      });
      router.back();
    } catch (e) {
      setError(t(`posting_error.${e instanceof PostingError ? e.code : "UNKNOWN"}`));
      clientUuid.current = globalThis.crypto.randomUUID();
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg, paddingTop: insets.top + tokens.space[3] }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: tokens.space[4] }}>
        <Text style={{ flex: 1, fontSize: tokens.font.size.title, fontWeight: "700", color: tokens.color.text }}>
          {t("refund.title")}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
          onPress={() => (selected ? setSelected(null) : router.back())}
          style={{ minWidth: tokens.touchMin, minHeight: tokens.touchMin, alignItems: "center", justifyContent: "center" }}
        >
          <Text style={{ fontSize: tokens.font.size.title, color: tokens.color.textMuted }}>x</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: tokens.space[4], gap: tokens.space[3] }} keyboardShouldPersistTaps="handled">
        {error ? (
          <Text style={{ color: tokens.color.statusBad, fontSize: tokens.font.size.label }}>{error}</Text>
        ) : null}

        {selected ? (
          // Step two: how much, and why.
          <>
            <Card title={t("refund.refunding")}>
              <MoneyText amountMinor={Number(selected.amount_minor)} size="title" bangla={bangla} />
              <Text style={{ fontSize: tokens.font.size.caption, color: tokens.color.textMuted }}>
                {selected.reference ?? selected.category ?? t(`txn_kind.${selected.kind}`)}
              </Text>
            </Card>

            <Text style={{ fontSize: tokens.font.size.label, color: tokens.color.textMuted }}>
              {t("refund.how_much")}
            </Text>
            <AmountKeypad value={amount} onChange={setAmount} bangla={bangla} />

            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder={t("refund.reason")}
              accessibilityLabel={t("refund.reason")}
              style={{
                minHeight: tokens.touchMin,
                borderRadius: tokens.radius.md,
                borderWidth: 1,
                borderColor: tokens.color.divider,
                backgroundColor: tokens.color.surface,
                paddingHorizontal: tokens.space[4],
                fontSize: tokens.font.size.body,
                color: tokens.color.text,
              }}
            />

            <PrimaryButton
              label={t("refund.confirm")}
              busy={refund.isPending}
              disabled={keypadAmountMinor(amount) <= 0 || reason.trim().length < 3}
              onPress={submit}
            />
          </>
        ) : (
          // Step one: which payment.
          <>
            <Text style={{ fontSize: tokens.font.size.label, color: tokens.color.textMuted }}>
              {t("refund.which")}
            </Text>
            {isLoading ? (
              <ActivityIndicator color={tokens.color.brandPrimary} />
            ) : (
              refundable.map((txn) => (
                <Pressable
                  key={txn.id}
                  accessibilityRole="button"
                  onPress={() => { setSelected(txn); setAmount(String(Math.trunc(Number(txn.amount_minor) / 100))); }}
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                    backgroundColor: tokens.color.surface,
                    borderRadius: tokens.radius.md,
                    padding: tokens.space[4],
                    minHeight: tokens.touchMin,
                  }}
                >
                  <Text style={{ fontSize: tokens.font.size.body, color: tokens.color.text }} numberOfLines={1}>
                    {txn.reference ?? txn.category ?? t(`txn_kind.${txn.kind}`)}
                  </Text>
                  <MoneyText amountMinor={Number(txn.amount_minor)} bangla={bangla} />
                </Pressable>
              ))
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

export default function RefundScreen() {
  return (
    <RoleGuard type="MERCHANT">
      <Refund />
    </RoleGuard>
  );
}
