import { useMemo } from "react";
import { RefreshControl, StyleSheet, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { MoneyText, PrimaryButton, StatusPill, tokens } from "@bizflow/ui";
import { formatMoney } from "@bizflow/shared";
import { AppIcon } from "../../components/AppIcon";
import { Card, Divider, FeatureGrid, ListRow, Screen, ScreenHeader, Section, Skeleton, SourceBadge, type, useBangla, useDigits, type Feature } from "../../components/kit";
import { AnimatedMoney } from "../../components/motion";
import { useAgentAuditPreview, useClosingPreview, useCommissionSummary, useCustomerBalances, usePayables, useSupplierBalances, useTransactions, useWalletBreakdown } from "../../lib/api";
import { useActiveBusiness, useCanAddEntries, useIsOwner } from "../../lib/session";
import { dhakaDay, useBalanceMap } from "../../lib/view";

const c = tokens.color;

export default function BooksTab() {
  return useActiveBusiness()?.type === "AGENT" ? <Float /> : <Books />;
}

/** Merchant books: what was written today, the day-end ritual, and who owes whom. */
function Books() {
  const { t } = useTranslation();
  const router = useRouter();
  const bangla = useBangla();
  const active = useActiveBusiness();
  const canAdd = useCanAddEntries();
  const manager = useIsOwner() || active?.role === "manager";
  const balances = useBalanceMap();
  const txns = useTransactions(300);
  const closing = useClosingPreview();
  const customers = useCustomerBalances();
  const payables = usePayables(true);
  const suppliers = useSupplierBalances();
  const today = dhakaDay(new Date().toISOString());
  const sum = (kind: string) => (txns.data ?? []).filter((r) => r.kind === kind && dhakaDay(r.occurred_at) === today).reduce((s, r) => s + Number(r.amount_minor), 0);
  const owing = (customers.data ?? []).filter((x) => Number(x.balance_minor) > 0);
  const go = (route: string) => () => router.push(route as Href);

  const tiles: Feature[] = [
    ...(canAdd ? [
      { key: "sale", icon: "sale" as const, label: t("ux.f_sale"), onPress: go("/cash-sale"), tone: "good" as const },
      { key: "expense", icon: "expense" as const, label: t("ux.f_expense"), onPress: go("/expense"), tone: "bad" as const },
    ] : []),
    { key: "baki", icon: "baki", label: t("ux.f_baki"), onPress: go("/baki"), tone: "amber" },
    ...(manager ? [{ key: "suppliers", icon: "suppliers" as const, label: t("ux.f_suppliers"), onPress: go("/suppliers") }] : []),
  ];

  return (
    <Screen inTabs header={<ScreenHeader title={t("ux.books_title")} subtitle={t("ux.books_sub")} />} refreshControl={<RefreshControl refreshing={txns.isRefetching} onRefresh={() => { void txns.refetch(); void closing.refetch(); void balances.refetch(); }} tintColor={c.brandPrimary} />}>
      <View style={s.strip}>
        <Stat label={t("txn_kind.CASH_SALE")} amount={sum("CASH_SALE")} icon="sale" />
        <Stat label={t("expense.title")} amount={sum("EXPENSE")} icon="expense" />
        <Stat label={t("books.baki_outstanding")} amount={balances.of("1100")} icon="baki" />
      </View>

      <Section title={t("ux.write_entry")} hint={t("ux.record_only")}>
        <Card tone="manual" padded={false} style={{ padding: 6 }}><FeatureGrid items={tiles} columns={4} /></Card>
      </Section>

      {manager ? (
        <Card tone={closing.data?.already_closed ? undefined : "brand"}>
          {closing.isLoading ? <Skeleton height={80} /> : closing.data?.already_closed ? (
            <View style={s.row}>
              <AppIcon name="closing" size={28} color={c.statusGood} />
              <View style={{ flex: 1 }}><Text style={type.heading}>{t("ux.closing_done")}</Text><Text style={type.caption}>{t("history.merchant_hint")}</Text></View>
              <PrimaryButton variant="ghost" compact label={t("ux.see_all")} onPress={go("/history")} />
            </View>
          ) : (
            <View style={{ gap: tokens.space[3] }}>
              <View style={s.row}>
                <AppIcon name="clock" size={22} color={c.actionPrimary} />
                <Text style={[type.label, { color: c.onBrand, flex: 1 }]}>{t("ux.closing_pending")}</Text>
              </View>
              <View>
                <Text style={[type.caption, { color: c.onBrandMuted }]}>{t("ux.expected_drawer")}</Text>
                <AnimatedMoney amountMinor={closing.data?.expected_cash_minor ?? 0} size="numberLg" inverse />
              </View>
              <PrimaryButton label={t("closing.close")} icon={<AppIcon name="closing" size={20} color={c.actionPrimaryText} />} onPress={go("/closing")} />
            </View>
          )}
        </Card>
      ) : null}

      <Section title={t("ux.f_baki")} action={t("ux.see_all")} onAction={go("/baki")}>
        <Card padded={false} style={{ paddingHorizontal: tokens.space[2] }}>
          {customers.isLoading ? <View style={{ padding: 16 }}><Skeleton height={48} /></View> : owing.length === 0 ? (
            <ListRow icon="check" tone="good" title={t("ux.settled_up")} />
          ) : owing.slice(0, 3).map((x, i) => (
            <View key={x.customer_id}>
              {i > 0 ? <Divider inset={52} /> : null}
              <ListRow icon="user" tone="amber" title={x.name} subtitle={x.phone_last4 ? `01•••••${x.phone_last4}` : undefined} trailing={<MoneyText amountMinor={Number(x.balance_minor)} bangla={bangla} />} onPress={() => router.push({ pathname: "/baki-entry", params: { customer: x.customer_id } })} />
            </View>
          ))}
        </Card>
      </Section>

      {manager && (payables.data ?? []).length > 0 ? (
        <Section title={t("ux.bills")} action={t("ux.see_all")} onAction={go("/suppliers")}>
          <Card padded={false} style={{ paddingHorizontal: tokens.space[2] }}>
            {(payables.data ?? []).slice(0, 3).map((p, i) => {
              const overdue = p.status === "OVERDUE";
              return (
                <View key={p.id}>
                  {i > 0 ? <Divider inset={52} /> : null}
                  <ListRow icon="suppliers" tone={overdue ? "bad" : "brand"} title={suppliers.data?.find((x) => x.supplier_id === p.supplier_id)?.name ?? ""} subtitle={overdue ? t("ux.overdue") : t("ux.due_on", { date: p.due_date ?? "" })} trailing={<MoneyText amountMinor={Number(p.amount_remaining_minor)} bangla={bangla} />} onPress={go("/suppliers")} />
                </View>
              );
            })}
          </Card>
        </Section>
      ) : null}
    </Screen>
  );
}

function Stat({ label, amount, icon }: { label: string; amount: number; icon: "sale" | "expense" | "baki" }) {
  return (
    <View style={s.stat}>
      <View style={s.row}><AppIcon name={icon} size={15} color={c.manualTag} /><Text numberOfLines={1} style={[type.caption, { flex: 1 }]}>{label}</Text></View>
      <AnimatedMoney amountMinor={amount} size="label" />
    </View>
  );
}

/** Agent float: three buckets, how money moves between them, and the day-end audit. */
function Float() {
  const { t } = useTranslation();
  const router = useRouter();
  const bangla = useBangla();
  const digits = useDigits();
  const active = useActiveBusiness();
  const canAdd = useCanAddEntries();
  const isOwner = useIsOwner();
  const manager = isOwner || active?.role === "manager";
  const balances = useBalanceMap();
  const wallets = useWalletBreakdown();
  const audit = useAgentAuditPreview(manager);
  const commission = useCommissionSummary();
  const go = (route: string) => () => router.push(route as Href);
  const cash = balances.of("1000");
  const efloat = balances.of("1010");
  const tiles: Feature[] = useMemo(() => [
    ...(canAdd ? [{ key: "wallet", icon: "wallet" as const, label: t("ux.f_wallet"), onPress: go("/manual-wallet"), tone: "amber" as const }] : []),
    ...(manager ? [{ key: "audit", icon: "audit" as const, label: t("ux.f_audit"), onPress: go("/agent-audit"), tone: "good" as const }] : []),
    ...(isOwner ? [{ key: "commission", icon: "commission" as const, label: t("ux.f_commission"), onPress: go("/commission") }] : []),
    ...(manager ? [{ key: "history", icon: "history" as const, label: t("ux.f_history"), onPress: go("/history") }] : []),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [canAdd, manager, isOwner, t]);

  return (
    <Screen inTabs header={<ScreenHeader title={t("ux.float_title")} subtitle={t("ux.float_sub")} />} refreshControl={<RefreshControl refreshing={balances.isRefetching} onRefresh={() => { void balances.refetch(); void wallets.refetch(); void audit.refetch(); }} tintColor={c.brandPrimary} />}>
      <View style={{ gap: tokens.space[2] }}>
        <Bucket icon="cash" title={t("agent.cash_drawer")} amount={cash} />
        <Bucket icon="digital" title={t("ux.e_float")} amount={efloat} source="verified" />
        <Card tone="manual" style={{ gap: tokens.space[2] }}>
          <View style={s.row}>
            <AppIcon name="wallet" size={22} color={c.manualTag} />
            <Text style={[type.label, { flex: 1 }]}>{t("ux.other_wallets")}</Text>
            <SourceBadge source="manual" />
          </View>
          <AnimatedMoney amountMinor={balances.of("1030")} size="title" />
          {(wallets.data?.wallets ?? []).map((w) => (
            <View key={w.wallet} style={s.walletRow}>
              <Text style={[type.body, { flex: 1 }]}>{w.wallet}</Text>
              <Text style={type.caption}>{t("ux.today")} {digits(w.count)}</Text>
              <MoneyText amountMinor={Number(w.total_minor)} bangla={bangla} muted />
            </View>
          ))}
        </Card>
      </View>

      <Section title={t("ux.movement_title")}>
        <Card style={{ gap: tokens.space[2] }}>
          <View style={s.row}><AppIcon name="cash-in" size={22} color={c.statusGood} /><Text style={[type.body, { flex: 1, fontSize: 15 }]}>{t("ux.movement_in")}</Text></View>
          <Divider />
          <View style={s.row}><AppIcon name="cash-out" size={22} color={c.statusBad} /><Text style={[type.body, { flex: 1, fontSize: 15 }]}>{t("ux.movement_out")}</Text></View>
        </Card>
      </Section>

      <Card padded={false} style={{ padding: 6 }}><FeatureGrid items={tiles} columns={4} /></Card>

      {manager ? (
        <Card onPress={go("/agent-audit")} accessibilityLabel={t("ux.f_audit")}>
          <View style={s.row}>
            <AppIcon name="audit" size={24} color={audit.data?.already_audited ? c.statusGood : c.statusWarn} />
            <Text style={[type.label, { flex: 1 }]}>{t(audit.data?.already_audited ? "ux.audit_done" : "ux.audit_pending")}</Text>
            <StatusPill kind={audit.data?.already_audited ? "good" : "warn"} compact label={t(audit.data?.already_audited ? "ux.settled" : "ux.pending")} />
          </View>
        </Card>
      ) : null}

      {isOwner ? (
        <Card onPress={go("/commission")} accessibilityLabel={t("agent.commission")}>
          <View style={s.row}>
            <AppIcon name="commission" size={24} color={c.brandPrimary} />
            <View style={{ flex: 1 }}>
              <Text style={type.caption}>{t("agent.commission_today")}</Text>
              <AnimatedMoney amountMinor={commission.data?.today_minor ?? 0} size="title" />
            </View>
            <Text style={type.caption}>{t("commission.this_month")} {formatMoney(commission.data?.month_minor ?? 0, { bangla, currency: "taka-sign" })}</Text>
          </View>
        </Card>
      ) : null}
    </Screen>
  );
}

function Bucket({ icon, title, amount, source }: { icon: "cash" | "digital"; title: string; amount: number; source?: "verified" }) {
  return (
    <Card style={{ flexDirection: "row", alignItems: "center", gap: tokens.space[3] }}>
      <View style={s.bucketIcon}><AppIcon name={icon} size={24} color={c.brandPrimary} /></View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={s.row}><Text style={type.label}>{title}</Text>{source ? <SourceBadge source={source} /> : null}</View>
        <AnimatedMoney amountMinor={amount} size="title" />
      </View>
    </Card>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: tokens.space[2] },
  strip: { flexDirection: "row", gap: tokens.space[2] },
  stat: { flex: 1, padding: tokens.space[3], gap: 2, borderRadius: tokens.radius.md, backgroundColor: c.surface, ...tokens.shadow.card },
  walletRow: { flexDirection: "row", alignItems: "center", gap: tokens.space[3], minHeight: 32 },
  bucketIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: c.brandSoft, alignItems: "center", justifyContent: "center" },
});
