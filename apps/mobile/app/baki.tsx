import { useMemo, useState } from "react";
import { FlatList, Pressable, Share, StyleSheet, Switch, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { MoneyText, PrimaryButton, tokens } from "@bizflow/ui";
import { RoleGuard } from "../components/RoleGuard";
import { AppIcon } from "../components/AppIcon";
import { Card, EmptyState, Field, IconButton, IconTile, Notice, Screen, ScreenHeader, Sheet, SkeletonRows, showToast, type, useBangla, useDigits } from "../components/kit";
import { AnimatedMoney } from "../components/motion";
import { PostingError, useBakiReminderDraft, useCreateCustomer, useCustomerBalances } from "../lib/api";
import { feedback } from "../lib/feedback";
import { goBack } from "../lib/view";

const c = tokens.color;

/**
 * Baki book (docs/03 M5): who owes how much, like the paper khata. Tap a customer to write
 * "gave" or "received"; reminders are drafted for the owner to send, never sent for them.
 */
function Baki() {
  const { t } = useTranslation();
  const router = useRouter();
  const bangla = useBangla();
  const digits = useDigits();
  const customers = useCustomerBalances();
  const reminder = useBakiReminderDraft();
  const create = useCreateCustomer();
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = useMemo(() => (customers.data ?? []).filter((x) => x.name.toLowerCase().includes(query.trim().toLowerCase())), [customers.data, query]);
  const owing = (customers.data ?? []).filter((x) => Number(x.balance_minor) > 0);
  const total = owing.reduce((s, x) => s + Number(x.balance_minor), 0);

  async function remind(customerId: string) {
    try {
      const draft = await reminder.mutateAsync(customerId);
      await Share.share({ message: bangla ? draft.message_bn : draft.message_en });
    } catch (e) {
      feedback("error");
      showToast({ kind: "bad", title: t(`posting_error.${e instanceof PostingError ? e.code : "UNKNOWN"}`) });
    }
  }

  async function addCustomer() {
    setError(null);
    try {
      const result = await create.mutateAsync({ name: name.trim(), phone: phone.trim() || undefined, consent });
      setAdding(false);
      setName(""); setPhone(""); setConsent(false);
      router.push({ pathname: "/baki-entry", params: { customer: result.customer_id } });
    } catch (e) {
      setError(t(`posting_error.${e instanceof PostingError ? e.code : "UNKNOWN"}`));
    }
  }

  return (
    <Screen
      scroll={false}
      header={<ScreenHeader title={t("ux.f_baki")} onBack={() => goBack(router)} />}
      footer={<PrimaryButton label={t("ux.add_customer")} icon={<AppIcon name="plus" size={20} color={c.actionPrimaryText} />} onPress={() => setAdding(true)} />}
    >
      <FlatList
        data={list}
        keyExtractor={(x) => x.customer_id}
        contentContainerStyle={s.list}
        refreshing={customers.isRefetching}
        onRefresh={() => void customers.refetch()}
        ListHeaderComponent={
          <View style={{ gap: tokens.space[3], marginBottom: tokens.space[3] }}>
            <Card tone="manual">
              <Text style={type.caption}>{t("ux.baki_total")}</Text>
              <AnimatedMoney amountMinor={total} size="numberLg" />
              <Text style={type.caption}>{t("ux.baki_people", { count: owing.length })}</Text>
            </Card>
            <Field label={t("ux.baki_search")} icon="search" value={query} onChangeText={setQuery} />
          </View>
        }
        ListEmptyComponent={customers.isLoading ? <SkeletonRows /> : <EmptyState icon="users" title={t("empty.baki")} body={t("empty.baki_sub")} />}
        renderItem={({ item }) => {
          const owes = Number(item.balance_minor) > 0;
          return (
            <View style={s.row}>
              <Pressable accessibilityRole="button" accessibilityLabel={item.name} onPress={() => router.push({ pathname: "/baki-entry", params: { customer: item.customer_id } })} style={({ pressed }) => [s.rowMain, pressed && { opacity: 0.85 }]}>
                <IconTile name="user" tone={owes ? "amber" : "neutral"} size={42} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={type.label}>{item.name}</Text>
                  <Text style={type.caption}>{item.phone_last4 ? digits(`01•••••${item.phone_last4}`) : t(owes ? "ux.owes" : "ux.settled_up")}</Text>
                </View>
                {owes ? <MoneyText amountMinor={Number(item.balance_minor)} bangla={bangla} /> : <Text style={[type.caption, { color: c.statusGood }]}>{t("ux.settled_up")}</Text>}
              </Pressable>
              {owes && item.phone_last4 ? <IconButton name="send" label={t("ux.remind")} onPress={() => void remind(item.customer_id)} /> : null}
            </View>
          );
        }}
      />
      <Sheet visible={adding} onClose={() => setAdding(false)} title={t("ux.add_customer")} footer={<PrimaryButton label={t("ux.save")} busy={create.isPending} disabled={!name.trim()} onPress={() => void addCustomer()} />}>
        <Field label={t("ux.customer_name")} value={name} onChangeText={setName} autoFocus />
        <Field label={t("ux.customer_phone")} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="01XXXXXXXXX" />
        <View style={s.consent}>
          <Text style={[type.label, { flex: 1 }]}>{t("ux.consent")}</Text>
          <Switch value={consent} onValueChange={(v) => { feedback("tap"); setConsent(v); }} trackColor={{ true: c.brandPrimary, false: c.divider }} />
        </View>
        {error ? <Notice kind="bad" title={error} /> : null}
      </Sheet>
    </Screen>
  );
}

const s = StyleSheet.create({
  list: { padding: tokens.space[4], gap: 6, width: "100%", maxWidth: 560, alignSelf: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: tokens.space[2], paddingRight: tokens.space[2], borderRadius: tokens.radius.md, backgroundColor: c.surface },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: tokens.space[3], padding: tokens.space[3] },
  consent: { flexDirection: "row", alignItems: "center", gap: tokens.space[3], minHeight: 48 },
});

export default function BakiScreen() {
  return <RoleGuard type="MERCHANT"><Baki /></RoleGuard>;
}
