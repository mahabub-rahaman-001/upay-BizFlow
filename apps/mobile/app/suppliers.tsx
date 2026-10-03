import { useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { AmountKeypad, MoneyText, PrimaryButton, StatusPill, keypadAmountMinor, tokens } from "@bizflow/ui";
import { RoleGuard } from "../components/RoleGuard";
import { AppIcon } from "../components/AppIcon";
import { Card, Divider, EmptyState, Field, IconTile, ListRow, Notice, Screen, ScreenHeader, Segmented, Sheet, SkeletonRows, TextLink, showToast, type, useBangla, useDigits } from "../components/kit";
import { AnimatedMoney, SuccessSheet, type SuccessInfo } from "../components/motion";
import { PostingError, useCreatePayable, useCreateSupplier, usePayPayable, usePayables, useSupplierBalances, type PayableRow, type SupplierBalance } from "../lib/api";
import { feedback } from "../lib/feedback";
import { goBack } from "../lib/view";

const c = tokens.color;

/**
 * Suppliers and bills (docs/03 M6): the list answers "who do I owe, and when". Adding a
 * supplier, adding a bill and paying a bill each open a focused sheet instead of crowding
 * the list with forms.
 */
function Suppliers() {
  const { t } = useTranslation();
  const router = useRouter();
  const bangla = useBangla();
  const digits = useDigits();
  const suppliers = useSupplierBalances();
  const payables = usePayables(true);
  const createSupplier = useCreateSupplier();
  const createPayable = useCreatePayable();
  const pay = usePayPayable();
  const [open, setOpen] = useState<SupplierBalance | null>(null);
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [billFor, setBillFor] = useState<SupplierBalance | null>(null);
  const [paying, setPaying] = useState<PayableRow | null>(null);
  const [name, setName] = useState("");
  const [billAmount, setBillAmount] = useState("");
  const [billRef, setBillRef] = useState("");
  const [billDue, setBillDue] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [paidFrom, setPaidFrom] = useState<"cash" | "wallet">("cash");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessInfo | null>(null);
  const payUuid = useRef(globalThis.crypto.randomUUID());

  const total = (suppliers.data ?? []).reduce((s, x) => s + Number(x.due_minor), 0);
  const overdue = (payables.data ?? []).filter((p) => p.status === "OVERDUE");
  const bills = (id: string) => (payables.data ?? []).filter((p) => p.supplier_id === id);
  const fail = (e: unknown) => { feedback("error"); setError(t(`posting_error.${e instanceof PostingError ? e.code : "UNKNOWN"}`)); };

  async function saveSupplier() {
    setError(null);
    try { await createSupplier.mutateAsync({ name: name.trim() }); setName(""); setAddingSupplier(false); showToast({ kind: "good", title: t("ux.save") }); } catch (e) { fail(e); }
  }
  async function saveBill() {
    if (!billFor) return;
    setError(null);
    const due = /^\d{4}-\d{2}-\d{2}$/.test(billDue.trim()) ? billDue.trim() : undefined;
    try {
      await createPayable.mutateAsync({ supplier_id: billFor.supplier_id, amount_minor: keypadAmountMinor(billAmount), invoice_ref: billRef.trim() || undefined, due_date: due });
      setBillFor(null); setBillAmount(""); setBillRef(""); setBillDue("");
      feedback("success");
      showToast({ kind: "manual", title: t("ux.add_bill"), amountMinor: keypadAmountMinor(billAmount) });
    } catch (e) { fail(e); }
  }
  async function payBill() {
    if (!paying) return;
    setError(null);
    const amount = keypadAmountMinor(payAmount);
    try {
      await pay.mutateAsync({ payable_id: paying.id, amount_minor: amount, paid_from: paidFrom, client_uuid: payUuid.current });
      const who = suppliers.data?.find((x) => x.supplier_id === paying.supplier_id)?.name;
      setPaying(null);
      payUuid.current = globalThis.crypto.randomUUID();
      setSuccess({ title: t("ux.bill_paid"), amountMinor: amount, sign: "out", source: "manual", detail: who });
    } catch (e) { fail(e); payUuid.current = globalThis.crypto.randomUUID(); }
  }

  return (
    <Screen
      scroll={false}
      header={<ScreenHeader title={t("suppliers.title")} onBack={() => goBack(router)} />}
      footer={<PrimaryButton label={t("ux.add_supplier")} icon={<AppIcon name="plus" size={20} color={c.actionPrimaryText} />} onPress={() => { setError(null); setAddingSupplier(true); }} />}
    >
      <FlatList
        data={suppliers.data ?? []}
        keyExtractor={(x) => x.supplier_id}
        contentContainerStyle={s.list}
        refreshing={suppliers.isRefetching}
        onRefresh={() => { void suppliers.refetch(); void payables.refetch(); }}
        ListHeaderComponent={
          <View style={{ gap: tokens.space[3], marginBottom: tokens.space[3] }}>
            <Card>
              <Text style={type.caption}>{t("ux.supplier_total")}</Text>
              <AnimatedMoney amountMinor={total} size="numberLg" />
              {overdue.length ? <StatusPill kind="bad" compact icon={<AppIcon name="alert" size={12} color={c.statusBad} />} label={`${t("ux.overdue")} · ${digits(overdue.length)}`} /> : <StatusPill kind="good" compact label={t("ux.no_due")} />}
            </Card>
          </View>
        }
        ListEmptyComponent={suppliers.isLoading ? <SkeletonRows /> : <EmptyState icon="suppliers" title={t("empty.suppliers")} body={t("empty.suppliers_sub")} />}
        renderItem={({ item }) => {
          const late = bills(item.supplier_id).some((p) => p.status === "OVERDUE");
          return (
            <Pressable accessibilityRole="button" accessibilityLabel={item.name} onPress={() => setOpen(item)} style={({ pressed }) => [s.row, pressed && { opacity: 0.85 }]}>
              <IconTile name="suppliers" tone={late ? "bad" : Number(item.due_minor) > 0 ? "brand" : "neutral"} size={42} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={type.label}>{item.name}</Text>
                <Text style={[type.caption, late && { color: c.statusBad }]}>{late ? t("ux.overdue") : Number(item.due_minor) > 0 ? `${t("ux.bills")} · ${digits(item.open_count)}` : t("ux.no_due")}</Text>
              </View>
              {Number(item.due_minor) > 0 ? <MoneyText amountMinor={Number(item.due_minor)} bangla={bangla} /> : null}
              <AppIcon name="chevron" size={16} color={c.textMuted} />
            </Pressable>
          );
        }}
      />

      <Sheet visible={!!open && !paying && !billFor} onClose={() => setOpen(null)} title={open?.name ?? ""} subtitle={t("ux.bills")}
        footer={<PrimaryButton variant="secondary" label={t("ux.add_bill")} icon={<AppIcon name="plus" size={18} color={c.brandPrimary} />} onPress={() => { setError(null); setBillFor(open); }} />}>
        {open && bills(open.supplier_id).length === 0 ? <Notice kind="good" title={t("ux.no_due")} /> : null}
        <Card padded={false} style={{ paddingHorizontal: tokens.space[2] }}>
          {open ? bills(open.supplier_id).map((p, i) => (
            <View key={p.id}>
              {i > 0 ? <Divider inset={52} /> : null}
              <ListRow icon="receipt" tone={p.status === "OVERDUE" ? "bad" : "brand"} title={p.invoice_ref ?? t("ux.bills")} subtitle={p.status === "OVERDUE" ? t("ux.overdue") : p.status === "PARTIALLY_PAID" ? t("suppliers.partly_paid") : t("ux.due_on", { date: p.due_date ?? "-" })}
                trailing={<View style={{ alignItems: "flex-end" }}><MoneyText amountMinor={Number(p.amount_remaining_minor)} bangla={bangla} /><TextLink label={t("suppliers.pay")} onPress={() => { setError(null); setPayAmount(String(Math.trunc(Number(p.amount_remaining_minor) / 100))); setPaying(p); }} /></View>} />
            </View>
          )) : null}
        </Card>
      </Sheet>

      <Sheet visible={addingSupplier} onClose={() => setAddingSupplier(false)} title={t("ux.add_supplier")} footer={<PrimaryButton label={t("ux.save")} busy={createSupplier.isPending} disabled={!name.trim()} onPress={() => void saveSupplier()} />}>
        <Field label={t("suppliers.supplier_name")} value={name} onChangeText={setName} autoFocus />
        {error ? <Notice kind="bad" title={error} /> : null}
      </Sheet>

      <Sheet visible={!!billFor} onClose={() => setBillFor(null)} title={t("ux.add_bill")} subtitle={billFor?.name} footer={<PrimaryButton label={t("suppliers.save_bill")} busy={createPayable.isPending} disabled={keypadAmountMinor(billAmount) <= 0} onPress={() => void saveBill()} />}>
        <Text style={type.label}>{t("ux.bill_amount")}</Text>
        <AmountKeypad value={billAmount} onChange={setBillAmount} bangla={bangla} compact />
        <Field label={t("suppliers.invoice_ref")} value={billRef} onChangeText={setBillRef} />
        <Field label={t("ux.due_date")} value={billDue} onChangeText={setBillDue} placeholder="2026-10-10" keyboardType="numbers-and-punctuation" />
        {error ? <Notice kind="bad" title={error} /> : null}
      </Sheet>

      <Sheet visible={!!paying} onClose={() => setPaying(null)} title={t("ux.pay_bill")} subtitle={paying?.invoice_ref ?? undefined} footer={<PrimaryButton label={t("suppliers.pay")} busy={pay.isPending} disabled={keypadAmountMinor(payAmount) <= 0 || keypadAmountMinor(payAmount) > Number(paying?.amount_remaining_minor ?? 0)} onPress={() => void payBill()} />}>
        <AmountKeypad value={payAmount} onChange={setPayAmount} bangla={bangla} compact />
        <Text style={type.label}>{t("ux.paid_from")}</Text>
        <Segmented value={paidFrom} onChange={setPaidFrom} items={[{ key: "cash", label: t("expense.from_cash"), icon: "cash" }, { key: "wallet", label: t("expense.from_wallet"), icon: "digital" }]} />
        {error ? <Notice kind="bad" title={error} /> : null}
      </Sheet>

      <SuccessSheet info={success} onDone={() => setSuccess(null)} />
    </Screen>
  );
}

const s = StyleSheet.create({
  list: { padding: tokens.space[4], gap: 6, width: "100%", maxWidth: 560, alignSelf: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: tokens.space[3], padding: tokens.space[3], borderRadius: tokens.radius.md, backgroundColor: c.surface },
});

export default function SuppliersScreen() {
  return <RoleGuard type="MERCHANT"><Suppliers /></RoleGuard>;
}
