import { RoleGuard } from "../components/RoleGuard";
import { useRef, useState } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { keypadAmountMinor, tokens } from "@bizflow/ui";
import type { ExpenseInput } from "@bizflow/shared";
import { PostingError, usePostExpense } from "../lib/api";
import { ChoiceRow, MoneyEntryScreen } from "../components/MoneyEntryScreen";

type ExpenseType = ExpenseInput["expense_type"];

const TYPES: ExpenseType[] = [
  "supplier_purchase",
  "rent",
  "electricity",
  "transport",
  "salary",
  "other",
];

/**
 * Record an expense (docs/03 M4). Two things have to be said: what it was for and where
 * the money came from, because those pick the accounts the entry posts to - 5100 against
 * the drawer or against the wallet.
 */
function Expense() {
  const { t } = useTranslation();
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [expenseType, setExpenseType] = useState<ExpenseType>("other");
  const [paidFrom, setPaidFrom] = useState<"cash" | "wallet">("cash");
  const [error, setError] = useState<string | null>(null);
  const clientUuid = useRef(globalThis.crypto.randomUUID());
  const post = usePostExpense();

  const amountMinor = keypadAmountMinor(amount);

  async function save() {
    setError(null);
    try {
      await post.mutateAsync({
        amount_minor: amountMinor,
        expense_type: expenseType,
        paid_from: paidFrom,
        client_uuid: clientUuid.current,
      });
      router.back();
    } catch (e) {
      setError(t(`posting_error.${e instanceof PostingError ? e.code : "UNKNOWN"}`));
      clientUuid.current = globalThis.crypto.randomUUID();
    }
  }

  return (
    <MoneyEntryScreen
      title={t("expense.title")}
      amount={amount}
      onAmountChange={setAmount}
      saveLabel={t("expense.save")}
      canSave={amountMinor > 0}
      busy={post.isPending}
      error={error}
      onSave={save}
    >
      <View style={{ gap: tokens.space[2] }}>
        <Label text={t("expense.what_for")} />
        <ChoiceRow
          value={expenseType}
          onChange={(next) => setExpenseType((next as ExpenseType) ?? "other")}
          options={TYPES.map((key) => ({ key, label: t(`expense.types.${key}`) }))}
        />
      </View>

      <View style={{ gap: tokens.space[2] }}>
        <Label text={t("expense.paid_from")} />
        <ChoiceRow
          value={paidFrom}
          onChange={(next) => setPaidFrom((next as "cash" | "wallet") ?? "cash")}
          options={[
            { key: "cash", label: t("expense.from_cash") },
            { key: "wallet", label: t("expense.from_wallet") },
          ]}
        />
      </View>
    </MoneyEntryScreen>
  );
}

function Label({ text }: { text: string }) {
  return (
    <Text style={{ fontSize: tokens.font.size.label, color: tokens.color.textMuted }}>
      {text}
    </Text>
  );
}

export default function ExpenseScreen() {
  return (
    <RoleGuard type="MERCHANT">
      <Expense />
    </RoleGuard>
  );
}
