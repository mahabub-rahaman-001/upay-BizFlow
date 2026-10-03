import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { keypadAmountMinor } from "@bizflow/ui";
import type { ExpenseInput } from "@bizflow/shared";
import { RoleGuard } from "../components/RoleGuard";
import { ChoiceRow, MoneyEntryScreen } from "../components/MoneyEntryScreen";
import { Segmented } from "../components/kit";
import type { SuccessInfo } from "../components/motion";
import { PostingError, usePostExpense } from "../lib/api";
import { feedback } from "../lib/feedback";

type ExpenseType = ExpenseInput["expense_type"];
const TYPES: ExpenseType[] = ["supplier_purchase", "rent", "electricity", "transport", "salary", "other"];

/** An expense says what it was for and where the money came from (docs/03 M4). */
function Expense() {
  const { t } = useTranslation();
  const [amount, setAmount] = useState("");
  const [expenseType, setExpenseType] = useState<ExpenseType>("other");
  const [paidFrom, setPaidFrom] = useState<"cash" | "wallet">("cash");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessInfo | null>(null);
  const clientUuid = useRef(globalThis.crypto.randomUUID());
  const post = usePostExpense();
  const amountMinor = keypadAmountMinor(amount);

  async function save() {
    setError(null);
    try {
      const result = await post.mutateAsync({ amount_minor: amountMinor, expense_type: expenseType, paid_from: paidFrom, client_uuid: clientUuid.current });
      const queued = (result as { queued?: boolean }).queued;
      setSuccess({ title: t("ux.expense_saved"), amountMinor, sign: "out", source: "manual", detail: queued ? t("ux.saved_offline") : `${t(`expense.types.${expenseType}`)} · ${t(paidFrom === "cash" ? "expense.from_cash" : "expense.from_wallet")}` });
    } catch (e) {
      feedback("error");
      setError(t(`posting_error.${e instanceof PostingError ? e.code : "UNKNOWN"}`));
      clientUuid.current = globalThis.crypto.randomUUID();
    }
  }

  return (
    <MoneyEntryScreen
      title={t("expense.title")} amount={amount} onAmountChange={setAmount} saveLabel={t("expense.save")} canSave={amountMinor > 0} busy={post.isPending} error={error} onSave={() => void save()} success={success}
      onAddAnother={() => { setSuccess(null); setAmount(""); clientUuid.current = globalThis.crypto.randomUUID(); }}
    >
      <ChoiceRow label={t("expense.what_for")} value={expenseType} onChange={(next) => setExpenseType((next as ExpenseType) ?? "other")} options={TYPES.map((key) => ({ key, label: t(`expense.types.${key}`) }))} />
      <Segmented value={paidFrom} onChange={setPaidFrom} items={[{ key: "cash", label: t("expense.from_cash"), icon: "cash" }, { key: "wallet", label: t("expense.from_wallet"), icon: "digital" }]} />
    </MoneyEntryScreen>
  );
}

export default function ExpenseScreen() {
  return <RoleGuard type="MERCHANT"><Expense /></RoleGuard>;
}
