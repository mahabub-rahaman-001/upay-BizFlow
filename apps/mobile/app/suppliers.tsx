import { RoleGuard } from "../components/RoleGuard";
import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Card, EmptyState, MoneyText, PrimaryButton, StatusPill, keypadAmountMinor, tokens, AmountKeypad } from "@bizflow/ui";
import {
  PostingError,
  useCreatePayable,
  useCreateSupplier,
  usePayPayable,
  usePayables,
  useSupplierBalances,
  type PayableRow,
} from "../lib/api";

/**
 * Suppliers and payables (docs/03 M6). The list answers the owner's real question - who do
 * I owe and when is it due - and each bill can be paid from here in cash or wallet. Adding
 * a supplier or a bill is inline so the whole thing is one screen, not a maze.
 *
 * Owner and manager only; staff never see supplier money (docs/02 section 4).
 */
function Suppliers() {
  const insets = useSafeAreaInsets();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const bangla = i18n.language === "bn";

  const { data: suppliers, isLoading } = useSupplierBalances();
  const { data: payables } = usePayables(true);
  const createSupplier = useCreateSupplier();
  const createPayable = useCreatePayable();
  const payPayable = usePayPayable();

  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const payClientUuid = useRef(globalThis.crypto.randomUUID());

  async function addSupplier() {
    setError(null);
    try {
      await createSupplier.mutateAsync({ name: newName.trim() });
      setNewName("");
    } catch (e) {
      setError(t(`posting_error.${e instanceof PostingError ? e.code : "UNKNOWN"}`));
    }
  }

  async function pay(payable: PayableRow, paidFrom: "cash" | "wallet") {
    const minor = keypadAmountMinor(payAmount);
    if (minor <= 0) return;
    setError(null);
    try {
      await payPayable.mutateAsync({
        payable_id: payable.id,
        amount_minor: minor,
        paid_from: paidFrom,
        client_uuid: payClientUuid.current,
      });
      setPayingId(null);
      setPayAmount("");
      payClientUuid.current = globalThis.crypto.randomUUID();
    } catch (e) {
      setError(t(`posting_error.${e instanceof PostingError ? e.code : "UNKNOWN"}`));
      payClientUuid.current = globalThis.crypto.randomUUID();
    }
  }

  const supplierName = (id: string) =>
    suppliers?.find((s) => s.supplier_id === id)?.name ?? "";

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg, paddingTop: insets.top + tokens.space[3] }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: tokens.space[4] }}>
        <Text style={{ flex: 1, fontSize: tokens.font.size.title, fontWeight: "700", color: tokens.color.text }}>
          {t("suppliers.title")}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
          onPress={() => router.back()}
          style={{ minWidth: tokens.touchMin, minHeight: tokens.touchMin, alignItems: "center", justifyContent: "center" }}
        >
          <Text style={{ fontSize: tokens.font.size.title, color: tokens.color.textMuted }}>x</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: tokens.space[4], gap: tokens.space[3] }} keyboardShouldPersistTaps="handled">
        {error ? (
          <Text style={{ color: tokens.color.statusBad, fontSize: tokens.font.size.label }}>{error}</Text>
        ) : null}

        {/* Bills still owing, soonest due first. */}
        {isLoading ? (
          <ActivityIndicator color={tokens.color.brandPrimary} />
        ) : (payables ?? []).length === 0 ? (
          <EmptyState message={t("suppliers.no_payables")} />
        ) : (
          (payables ?? []).map((payable) => (
            <Card key={payable.id}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ fontSize: tokens.font.size.body, fontWeight: "700", color: tokens.color.text }} numberOfLines={1}>
                  {supplierName(payable.supplier_id)}
                </Text>
                <MoneyText amountMinor={Number(payable.amount_remaining_minor)} bangla={bangla} />
              </View>
              <View style={{ flexDirection: "row", gap: tokens.space[2], alignItems: "center" }}>
                {payable.due_date ? (
                  <Text style={{ fontSize: tokens.font.size.caption, color: tokens.color.textMuted }}>
                    {t("suppliers.due")} {payable.due_date}
                  </Text>
                ) : null}
                {payable.status === "PARTIALLY_PAID" ? (
                  <StatusPill kind="warn" icon="~" label={t("suppliers.partly_paid")} />
                ) : null}
              </View>

              {payingId === payable.id ? (
                <View style={{ gap: tokens.space[2] }}>
                  <AmountKeypad value={payAmount} onChange={setPayAmount} bangla={bangla} />
                  <View style={{ flexDirection: "row", gap: tokens.space[2] }}>
                    <View style={{ flex: 1 }}>
                      <PrimaryButton
                        label={t("expense.from_cash")}
                        busy={payPayable.isPending}
                        disabled={keypadAmountMinor(payAmount) <= 0}
                        onPress={() => pay(payable, "cash")}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <PrimaryButton
                        label={t("expense.from_wallet")}
                        busy={payPayable.isPending}
                        disabled={keypadAmountMinor(payAmount) <= 0}
                        onPress={() => pay(payable, "wallet")}
                      />
                    </View>
                  </View>
                </View>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => { setPayingId(payable.id); setPayAmount(String(Math.trunc(Number(payable.amount_remaining_minor) / 100))); }}
                  style={{ minHeight: tokens.touchMin, justifyContent: "center" }}
                >
                  <Text style={{ color: tokens.color.brandPrimary, fontWeight: "700", fontSize: tokens.font.size.label }}>
                    {t("suppliers.pay")}
                  </Text>
                </Pressable>
              )}
            </Card>
          ))
        )}

        {/* Add a supplier. A bill is added from the supplier row once one exists. */}
        <Card title={t("suppliers.add_supplier")}>
          <View style={{ flexDirection: "row", gap: tokens.space[2], alignItems: "center" }}>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              placeholder={t("suppliers.supplier_name")}
              accessibilityLabel={t("suppliers.supplier_name")}
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
              accessibilityLabel={t("suppliers.add_supplier")}
              disabled={newName.trim().length === 0 || createSupplier.isPending}
              onPress={addSupplier}
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
              <Text style={{ fontSize: tokens.font.size.title, fontWeight: "700", color: tokens.color.surface }}>+</Text>
            </Pressable>
          </View>
        </Card>

        {(suppliers ?? []).length > 0 ? (
          <Card title={t("suppliers.your_suppliers")}>
            {(suppliers ?? []).map((supplier) => (
              <AddBillRow
                key={supplier.supplier_id}
                supplierId={supplier.supplier_id}
                name={supplier.name}
                dueMinor={Number(supplier.due_minor)}
                bangla={bangla}
                onAdd={async (amountMinor, invoiceRef) => {
                  setError(null);
                  try {
                    await createPayable.mutateAsync({
                      supplier_id: supplier.supplier_id,
                      amount_minor: amountMinor,
                      invoice_ref: invoiceRef || undefined,
                    });
                  } catch (e) {
                    setError(t(`posting_error.${e instanceof PostingError ? e.code : "UNKNOWN"}`));
                  }
                }}
              />
            ))}
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
}

/** A supplier row that expands into a small add-a-bill form. */
function AddBillRow({
  name,
  dueMinor,
  bangla,
  onAdd,
}: {
  supplierId: string;
  name: string;
  dueMinor: number;
  bangla: boolean;
  onAdd: (amountMinor: number, invoiceRef: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [invoice, setInvoice] = useState("");

  return (
    <View style={{ borderTopWidth: 1, borderTopColor: tokens.color.divider, paddingVertical: tokens.space[2], gap: tokens.space[2] }}>
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen((v) => !v)}
        style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: tokens.touchMin }}
      >
        <Text style={{ fontSize: tokens.font.size.body, color: tokens.color.text }} numberOfLines={1}>{name}</Text>
        {dueMinor > 0 ? <MoneyText amountMinor={dueMinor} bangla={bangla} muted /> : (
          <Text style={{ color: tokens.color.brandPrimary, fontWeight: "700", fontSize: tokens.font.size.label }}>
            {open ? "-" : t("suppliers.add_bill")}
          </Text>
        )}
      </Pressable>
      {open ? (
        <View style={{ gap: tokens.space[2] }}>
          <AmountKeypad value={amount} onChange={setAmount} bangla={bangla} />
          <TextInput
            value={invoice}
            onChangeText={setInvoice}
            placeholder={t("suppliers.invoice_ref")}
            accessibilityLabel={t("suppliers.invoice_ref")}
            style={{
              minHeight: tokens.touchMin,
              borderRadius: tokens.radius.md,
              borderWidth: 1,
              borderColor: tokens.color.divider,
              paddingHorizontal: tokens.space[3],
              fontSize: tokens.font.size.body,
              color: tokens.color.text,
            }}
          />
          <PrimaryButton
            label={t("suppliers.save_bill")}
            disabled={keypadAmountMinor(amount) <= 0}
            onPress={async () => {
              await onAdd(keypadAmountMinor(amount), invoice.trim());
              setAmount(""); setInvoice(""); setOpen(false);
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

export default function SuppliersScreen() {
  return (
    <RoleGuard type="MERCHANT">
      <Suppliers />
    </RoleGuard>
  );
}
