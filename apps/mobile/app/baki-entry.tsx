import { useRef, useState } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { MoneyText, keypadAmountMinor, tokens } from "@bizflow/ui";
import { RoleGuard } from "../components/RoleGuard";
import { MoneyEntryScreen } from "../components/MoneyEntryScreen";
import { IconTile, Segmented, type, useBangla } from "../components/kit";
import type { SuccessInfo } from "../components/motion";
import { PostingError, useCustomerBalances, usePostBakiCollection, usePostBakiSale } from "../lib/api";
import { feedback } from "../lib/feedback";

/** "Gave baki" or "received" for one customer: the two verbs of the paper khata. */
function BakiEntry() {
  const { t } = useTranslation();
  const bangla = useBangla();
  const params = useLocalSearchParams<{ customer?: string; dir?: string }>();
  const customers = useCustomerBalances();
  const customer = customers.data?.find((x) => x.customer_id === params.customer);
  const [direction, setDirection] = useState<"gave" | "got">(params.dir === "got" ? "got" : "gave");
  const [receivedIn, setReceivedIn] = useState<"cash" | "wallet">("cash");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessInfo | null>(null);
  const clientUuid = useRef(globalThis.crypto.randomUUID());
  const sale = usePostBakiSale();
  const collection = usePostBakiCollection();
  const amountMinor = keypadAmountMinor(amount);
  const balance = Number(customer?.balance_minor ?? 0);

  async function save() {
    if (!customer) return;
    setError(null);
    try {
      if (direction === "gave") await sale.mutateAsync({ amount_minor: amountMinor, customer_id: customer.customer_id, client_uuid: clientUuid.current });
      else await collection.mutateAsync({ amount_minor: amountMinor, customer_id: customer.customer_id, received_in: receivedIn, client_uuid: clientUuid.current });
      setSuccess({ title: t(direction === "gave" ? "ux.baki_saved" : "ux.collection_saved"), amountMinor, sign: direction === "got" ? "in" : undefined, source: "manual", detail: customer.name });
    } catch (e) {
      feedback("error");
      setError(t(`posting_error.${e instanceof PostingError ? e.code : "UNKNOWN"}`));
      clientUuid.current = globalThis.crypto.randomUUID();
    }
  }

  return (
    <MoneyEntryScreen
      title={t("baki.title")} amount={amount} onAmountChange={setAmount}
      saveLabel={t(direction === "gave" ? "baki.save_gave" : "baki.save_received")}
      canSave={amountMinor > 0 && !!customer && (direction === "gave" || amountMinor <= balance)}
      busy={sale.isPending || collection.isPending} error={error} onSave={() => void save()} success={success}
      onAddAnother={() => { setSuccess(null); setAmount(""); clientUuid.current = globalThis.crypto.randomUUID(); }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: tokens.space[3] }}>
        <IconTile name="user" tone="amber" size={44} />
        <View style={{ flex: 1 }}>
          <Text style={type.heading} numberOfLines={1}>{customer?.name ?? "..."}</Text>
          <Text style={type.caption}>{balance > 0 ? t("ux.owes") : t("ux.settled_up")}</Text>
        </View>
        {balance > 0 ? <MoneyText amountMinor={balance} bangla={bangla} size="title" /> : null}
      </View>
      <Segmented value={direction} onChange={setDirection} items={[{ key: "gave", label: t("ux.gave"), icon: "arrow-out" }, { key: "got", label: t("ux.got"), icon: "arrow-in" }]} />
      {direction === "got" ? (
        <View style={{ gap: 6 }}>
          <Text style={type.label}>{t("baki.received_in")}</Text>
          <Segmented value={receivedIn} onChange={setReceivedIn} items={[{ key: "cash", label: t("expense.from_cash"), icon: "cash" }, { key: "wallet", label: t("expense.from_wallet"), icon: "digital" }]} />
          {amountMinor > balance ? <Text style={[type.caption, { color: tokens.color.statusBad }]}>{t("posting_error.COLLECTION_EXCEEDS_BAKI")}</Text> : null}
        </View>
      ) : null}
    </MoneyEntryScreen>
  );
}

export default function BakiEntryScreen() {
  return <RoleGuard type="MERCHANT"><BakiEntry /></RoleGuard>;
}
