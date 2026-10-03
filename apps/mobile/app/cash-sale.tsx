import { RoleGuard } from "../components/RoleGuard";
import { useRef, useState } from "react";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { keypadAmountMinor } from "@bizflow/ui";
import { PostingError, usePostCashSale } from "../lib/api";
import { ChoiceRow, MoneyEntryScreen } from "../components/MoneyEntryScreen";
import { VoiceButton, VoiceConfirmModal, type VoiceDraft } from "../components/VoiceButton";

const CATEGORIES = ["grocery", "drinks", "snacks", "other"] as const;

/**
 * Quick cash sale (docs/04 section 13.5): at most two taps after the amount. The category
 * is optional and never blocks a sale, because a shopkeeper mid-queue should be able to
 * record the money and move on.
 *
 * The client_uuid is minted once per screen visit, so a double tap on Save or a retry over
 * bad signal replays the first entry instead of posting a second sale.
 */
function CashSale() {
  const { t } = useTranslation();
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [voiceDraft, setVoiceDraft] = useState<VoiceDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clientUuid = useRef(globalThis.crypto.randomUUID());
  const post = usePostCashSale();

  const amountMinor = keypadAmountMinor(amount);

  function confirmVoiceDraft(draft: VoiceDraft) {
    if (draft.amount_minor > 0) {
      setAmount(String(Math.floor(draft.amount_minor / 100)));
    }
    if (draft.category && (CATEGORIES as readonly string[]).includes(draft.category)) {
      setCategory(draft.category);
    }
    setVoiceDraft(null);
  }

  async function save() {
    setError(null);
    try {
      await post.mutateAsync({
        amount_minor: amountMinor,
        category: category ?? undefined,
        client_uuid: clientUuid.current,
        device_time: new Date().toISOString(),
      });
      router.back();
    } catch (e) {
      setError(t(`posting_error.${e instanceof PostingError ? e.code : "UNKNOWN"}`));
      clientUuid.current = globalThis.crypto.randomUUID();
    }
  }

  return (
    <MoneyEntryScreen
      title={t("cash_sale.title")}
      amount={amount}
      onAmountChange={setAmount}
      saveLabel={t("cash_sale.save")}
      canSave={amountMinor > 0}
      busy={post.isPending}
      error={error}
      onSave={save}
    >
      <ChoiceRow
        allowClear
        value={category}
        onChange={setCategory}
        options={CATEGORIES.map((key) => ({
          key,
          label: t(`cash_sale.categories.${key}`),
        }))}
      />
      <VoiceButton onDraft={setVoiceDraft} style={{ marginTop: 8 }} />
      <VoiceConfirmModal
        draft={voiceDraft}
        onConfirm={confirmVoiceDraft}
        onCancel={() => setVoiceDraft(null)}
      />
    </MoneyEntryScreen>
  );
}

export default function CashSaleScreen() {
  return (
    <RoleGuard type="MERCHANT">
      <CashSale />
    </RoleGuard>
  );
}
