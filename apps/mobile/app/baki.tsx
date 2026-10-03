import { RoleGuard } from "../components/RoleGuard";
import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, Share, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { MoneyText, keypadAmountMinor, tokens } from "@bizflow/ui";
import {
  PostingError,
  useBakiReminderDraft,
  useCreateCustomer,
  useCustomerBalances,
  usePostBakiCollection,
  usePostBakiSale,
} from "../lib/api";
import { ChoiceRow, MoneyEntryScreen } from "../components/MoneyEntryScreen";

type Direction = "gave" | "received";

/**
 * Baki (docs/03 M5). The two verbs are the whole model: "gave" means goods left on credit,
 * "received" means some of it came back. That wording is what shopkeepers already use in a
 * paper khata, so the screen does not ask anyone to learn accounting.
 *
 * Underneath it is ordinary double entry - 1100 Baki receivable against sales, or cash
 * against 1100 - so a customer's balance is derived from the ledger and cannot drift.
 */
function Baki() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const bangla = i18n.language === "bn";

  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<Direction>("gave");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [receivedIn, setReceivedIn] = useState<"cash" | "wallet">("cash");
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const clientUuid = useRef(globalThis.crypto.randomUUID());

  const { data: customers, isLoading } = useCustomerBalances();
  const reminder = useBakiReminderDraft();

  // Build a reminder draft for a customer who owes, then let the owner share it. Nothing is
  // sent automatically; a customer without consent is reported, not messaged.
  async function remind(cid: string) {
    setError(null);
    try {
      const draft = await reminder.mutateAsync(cid);
      await Share.share({ message: bangla ? draft.message_bn : draft.message_en });
    } catch (e) {
      setError(t(`posting_error.${e instanceof PostingError ? e.code : "UNKNOWN"}`));
    }
  }
  const createCustomer = useCreateCustomer();
  const postSale = usePostBakiSale();
  const postCollection = usePostBakiCollection();

  const amountMinor = keypadAmountMinor(amount);
  const busy = postSale.isPending || postCollection.isPending || createCustomer.isPending;

  async function addCustomer() {
    setError(null);
    try {
      const result = await createCustomer.mutateAsync({ name: newName.trim() });
      setCustomerId(result.customer_id);
      setNewName("");
    } catch (e) {
      setError(t(`posting_error.${e instanceof PostingError ? e.code : "UNKNOWN"}`));
    }
  }

  async function save() {
    if (!customerId) return;
    setError(null);
    try {
      if (direction === "gave") {
        await postSale.mutateAsync({
          amount_minor: amountMinor,
          customer_id: customerId,
          client_uuid: clientUuid.current,
        });
      } else {
        await postCollection.mutateAsync({
          amount_minor: amountMinor,
          customer_id: customerId,
          received_in: receivedIn,
          client_uuid: clientUuid.current,
        });
      }
      router.back();
    } catch (e) {
      setError(t(`posting_error.${e instanceof PostingError ? e.code : "UNKNOWN"}`));
      clientUuid.current = globalThis.crypto.randomUUID();
    }
  }

  return (
    <MoneyEntryScreen
      title={t("baki.title")}
      amount={amount}
      onAmountChange={setAmount}
      saveLabel={direction === "gave" ? t("baki.save_gave") : t("baki.save_received")}
      canSave={amountMinor > 0 && !!customerId}
      busy={busy}
      error={error}
      onSave={save}
    >
      <ChoiceRow
        value={direction}
        onChange={(next) => setDirection((next as Direction) ?? "gave")}
        options={[
          { key: "gave", label: t("baki.gave") },
          { key: "received", label: t("baki.received") },
        ]}
      />

      {direction === "received" ? (
        <View style={{ gap: tokens.space[2] }}>
          <Text style={{ fontSize: tokens.font.size.label, color: tokens.color.textMuted }}>
            {t("baki.received_in")}
          </Text>
          <ChoiceRow
            value={receivedIn}
            onChange={(next) => setReceivedIn((next as "cash" | "wallet") ?? "cash")}
            options={[
              { key: "cash", label: t("expense.from_cash") },
              { key: "wallet", label: t("expense.from_wallet") },
            ]}
          />
        </View>
      ) : null}

      <View style={{ gap: tokens.space[2] }}>
        <Text style={{ fontSize: tokens.font.size.label, color: tokens.color.textMuted }}>
          {t("baki.which_customer")}
        </Text>

        {isLoading ? (
          <ActivityIndicator color={tokens.color.brandPrimary} />
        ) : (
          <View
            style={{
              backgroundColor: tokens.color.surface,
              borderRadius: tokens.radius.md,
              overflow: "hidden",
            }}
          >
            {(customers ?? []).map((customer) => {
              const selected = customerId === customer.customer_id;
              return (
                <Pressable
                  key={customer.customer_id}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setCustomerId(customer.customer_id)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: tokens.space[3],
                    minHeight: tokens.touchMin,
                    paddingHorizontal: tokens.space[4],
                    borderBottomWidth: 1,
                    borderBottomColor: tokens.color.divider,
                    backgroundColor: selected ? tokens.color.aiTint : tokens.color.surface,
                  }}
                >
                  <Text
                    numberOfLines={1}
                    style={{
                      flex: 1,
                      fontSize: tokens.font.size.body,
                      fontWeight: selected ? "700" : "400",
                      color: tokens.color.text,
                    }}
                  >
                    {customer.name}
                    {customer.phone_last4 ? `  01****${customer.phone_last4}` : ""}
                  </Text>
                  <MoneyText
                    amountMinor={Number(customer.balance_minor)}
                    bangla={bangla}
                    muted={Number(customer.balance_minor) === 0}
                  />
                  {Number(customer.balance_minor) > 0 ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("baki.remind")}
                      disabled={reminder.isPending}
                      onPress={() => remind(customer.customer_id)}
                      style={{ minHeight: tokens.touchMin, justifyContent: "center", paddingLeft: tokens.space[3] }}
                    >
                      <Text style={{ color: tokens.color.brandPrimary, fontWeight: "700", fontSize: tokens.font.size.label }}>
                        {t("baki.remind")}
                      </Text>
                    </Pressable>
                  ) : null}
                </Pressable>
              );
            })}

            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: tokens.space[2],
                padding: tokens.space[3],
              }}
            >
              <TextInput
                value={newName}
                onChangeText={setNewName}
                placeholder={t("baki.new_customer")}
                accessibilityLabel={t("baki.new_customer")}
                style={{
                  flex: 1,
                  minHeight: tokens.touchMin,
                  borderRadius: tokens.radius.md,
                  borderWidth: 1,
                  borderColor: tokens.color.divider,
                  paddingHorizontal: tokens.space[3],
                  fontSize: tokens.font.size.body,
                  color: tokens.color.text,
                }}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("baki.add_customer")}
                disabled={newName.trim().length === 0}
                onPress={addCustomer}
                style={{
                  minWidth: tokens.touchMin,
                  minHeight: tokens.touchMin,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: tokens.radius.md,
                  backgroundColor: tokens.color.brandPrimary,
                  opacity: newName.trim().length === 0 ? 0.5 : 1,
                }}
              >
                <Text
                  style={{
                    fontSize: tokens.font.size.title,
                    fontWeight: "700",
                    color: tokens.color.surface,
                  }}
                >
                  +
                </Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>
    </MoneyEntryScreen>
  );
}

export default function BakiScreen() {
  return (
    <RoleGuard type="MERCHANT">
      <Baki />
    </RoleGuard>
  );
}
