import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { keypadAmountMinor } from "@bizflow/ui";
import { RoleGuard } from "../components/RoleGuard";
import { ChoiceRow, MoneyEntryScreen } from "../components/MoneyEntryScreen";
import { Field, Segmented } from "../components/kit";
import type { SuccessInfo } from "../components/motion";
import { PostingError, usePostManualWallet } from "../lib/api";
import { feedback } from "../lib/feedback";

const KNOWN_WALLETS = ["bKash", "Nagad", "Rocket"] as const;

/**
 * Another provider's transaction, written by hand (docs/03 M4). It is always labelled
 * Manual and never mixed with upay-verified records; the direction says which way the
 * cash drawer moved.
 */
function ManualWallet() {
  const { t } = useTranslation();
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<"cash_out" | "cash_in">("cash_out");
  const [wallet, setWallet] = useState<string | null>("bKash");
  const [customWallet, setCustomWallet] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessInfo | null>(null);
  const clientUuid = useRef(globalThis.crypto.randomUUID());
  const post = usePostManualWallet();
  const amountMinor = keypadAmountMinor(amount);
  const walletName = wallet === "other" ? customWallet.trim() : wallet;

  async function save() {
    if (!walletName) return;
    setError(null);
    try {
      await post.mutateAsync({ amount_minor: amountMinor, wallet: walletName, direction, note: note.trim() || undefined, client_uuid: clientUuid.current, device_time: new Date().toISOString() });
      setSuccess({ title: t("ux.wallet_saved"), amountMinor, sign: direction === "cash_in" ? "in" : "out", source: "manual", detail: `${walletName} · ${t(direction === "cash_in" ? "ux.dir_cash_in" : "ux.dir_cash_out")}` });
    } catch (e) {
      feedback("error");
      setError(t(`posting_error.${e instanceof PostingError ? e.code : "UNKNOWN"}`));
      clientUuid.current = globalThis.crypto.randomUUID();
    }
  }

  return (
    <MoneyEntryScreen
      title={t("agent.manual_wallet")} amount={amount} onAmountChange={setAmount} saveLabel={t("agent.save_manual")} canSave={amountMinor > 0 && !!walletName} busy={post.isPending} error={error} onSave={() => void save()} success={success}
      onAddAnother={() => { setSuccess(null); setAmount(""); setNote(""); clientUuid.current = globalThis.crypto.randomUUID(); }}
    >
      <Segmented value={direction} onChange={setDirection} items={[{ key: "cash_out", label: t("ux.dir_cash_out"), icon: "cash-out" }, { key: "cash_in", label: t("ux.dir_cash_in"), icon: "cash-in" }]} />
      <ChoiceRow label={t("agent.which_wallet")} value={wallet} onChange={setWallet} options={[...KNOWN_WALLETS.map((key) => ({ key, label: key })), { key: "other", label: t("agent.other_wallet") }]} />
      {wallet === "other" ? <Field label={t("agent.wallet_name")} value={customWallet} onChangeText={setCustomWallet} maxLength={40} /> : null}
      <Field label={t("ux.note_optional")} value={note} onChangeText={setNote} maxLength={240} />
    </MoneyEntryScreen>
  );
}

export default function ManualWalletScreen() {
  return <RoleGuard type="AGENT"><ManualWallet /></RoleGuard>;
}
