import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { keypadAmountMinor } from "@bizflow/ui";
import { RoleGuard } from "../components/RoleGuard";
import { ChoiceRow, MoneyEntryScreen } from "../components/MoneyEntryScreen";
import { VoiceButton, VoiceConfirmModal, type VoiceDraft } from "../components/VoiceButton";
import type { SuccessInfo } from "../components/motion";
import { PostingError, usePostCashSale } from "../lib/api";
import { feedback } from "../lib/feedback";

const CATEGORIES = ["grocery", "drinks", "snacks", "other"] as const;

/**
 * Quick cash sale (docs/04 13.5): amount, an optional category, Save. The client_uuid is
 * minted once per entry, so a double tap or a retry over bad signal replays instead of
 * posting twice.
 */
function CashSale() {
  const { t } = useTranslation();
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [voiceDraft, setVoiceDraft] = useState<VoiceDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessInfo | null>(null);
  const clientUuid = useRef(globalThis.crypto.randomUUID());
  const post = usePostCashSale();
  const amountMinor = keypadAmountMinor(amount);

  async function save() {
    setError(null);
    try {
      const result = await post.mutateAsync({ amount_minor: amountMinor, category: category ?? undefined, client_uuid: clientUuid.current, device_time: new Date().toISOString() });
      const queued = (result as { queued?: boolean }).queued;
      setSuccess({ title: t("ux.cash_sale_saved"), amountMinor, sign: "in", source: "manual", detail: queued ? t("ux.saved_offline") : category ? t(`cash_sale.categories.${category}`) : undefined });
    } catch (e) {
      feedback("error");
      setError(t(`posting_error.${e instanceof PostingError ? e.code : "UNKNOWN"}`));
      clientUuid.current = globalThis.crypto.randomUUID();
    }
  }

  function again() {
    setSuccess(null);
    setAmount("");
    setCategory(null);
    clientUuid.current = globalThis.crypto.randomUUID();
  }

  return (
    <MoneyEntryScreen title={t("cash_sale.title")} amount={amount} onAmountChange={setAmount} saveLabel={t("cash_sale.save")} canSave={amountMinor > 0} busy={post.isPending} error={error} onSave={() => void save()} success={success} onAddAnother={again}>
      <ChoiceRow label={t("ux.category_optional")} allowClear value={category} onChange={setCategory} options={CATEGORIES.map((key) => ({ key, label: t(`cash_sale.categories.${key}`) }))} />
      <VoiceButton onDraft={setVoiceDraft} />
      <VoiceConfirmModal
        draft={voiceDraft}
        onConfirm={(draft) => {
          if (draft.amount_minor > 0) setAmount(String(Math.floor(draft.amount_minor / 100)));
          if (draft.category && (CATEGORIES as readonly string[]).includes(draft.category)) setCategory(draft.category);
          setVoiceDraft(null);
        }}
        onCancel={() => setVoiceDraft(null)}
      />
    </MoneyEntryScreen>
  );
}

export default function CashSaleScreen() {
  return <RoleGuard type="MERCHANT"><CashSale /></RoleGuard>;
}
