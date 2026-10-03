import { RoleGuard } from "../components/RoleGuard";
import { useRef, useState } from "react";
import { Text, TextInput } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { keypadAmountMinor, tokens } from "@bizflow/ui";
import { ChoiceRow, MoneyEntryScreen } from "../components/MoneyEntryScreen";
import { PostingError, usePostManualWallet } from "../lib/api";

const KNOWN_WALLETS = ["bKash", "Nagad", "Rocket"] as const;

function ManualWallet() {
  const { t } = useTranslation();
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [wallet, setWallet] = useState<string | null>(null);
  const [customWallet, setCustomWallet] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const clientUuid = useRef(globalThis.crypto.randomUUID());
  const post = usePostManualWallet();
  const amountMinor = keypadAmountMinor(amount);
  const walletName = wallet === "other" ? customWallet.trim() : wallet;

  async function save() {
    if (!walletName) return;
    setError(null);
    try {
      await post.mutateAsync({
        amount_minor: amountMinor,
        wallet: walletName,
        note: note.trim() || undefined,
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
      title={t("agent.manual_wallet")}
      amount={amount}
      onAmountChange={setAmount}
      saveLabel={t("agent.save_manual")}
      canSave={amountMinor > 0 && !!walletName}
      busy={post.isPending}
      error={error}
      onSave={save}
    >
      <Text style={{ color: tokens.color.textMuted, fontSize: tokens.font.size.label }}>
        {t("agent.which_wallet")}
      </Text>
      <ChoiceRow
        value={wallet}
        onChange={setWallet}
        options={[
          ...KNOWN_WALLETS.map((key) => ({ key, label: key })),
          { key: "other", label: t("agent.other_wallet") },
        ]}
      />
      {wallet === "other" ? (
        <TextInput
          value={customWallet}
          onChangeText={setCustomWallet}
          placeholder={t("agent.wallet_name")}
          accessibilityLabel={t("agent.wallet_name")}
          maxLength={40}
          style={inputStyle}
        />
      ) : null}
      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder={t("agent.note_optional")}
        accessibilityLabel={t("agent.note_optional")}
        maxLength={240}
        style={inputStyle}
      />
      <Text style={{ color: tokens.color.statusWarn, fontSize: tokens.font.size.caption }}>
        {t("agent.manual_label_help")}
      </Text>
    </MoneyEntryScreen>
  );
}

const inputStyle = {
  minHeight: tokens.touchMin,
  borderRadius: tokens.radius.md,
  borderWidth: 1,
  borderColor: tokens.color.divider,
  backgroundColor: tokens.color.surface,
  paddingHorizontal: tokens.space[4],
  fontSize: tokens.font.size.body,
  color: tokens.color.text,
} as const;

export default function ManualWalletScreen() {
  return (
    <RoleGuard type="AGENT">
      <ManualWallet />
    </RoleGuard>
  );
}
