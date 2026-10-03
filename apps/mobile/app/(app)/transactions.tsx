import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, Share, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { TxnRow, tokens } from "@bizflow/ui";
import { useReceiptLink, useTransactions, type TransactionRow } from "../../lib/api";
import { useActiveBusiness } from "../../lib/session";
import { EmptyState, ErrorState } from "../../components/EmptyState";

/**
 * The transaction list (docs/07 section 4). Verified and hand-entered rows sit in one
 * list, told apart by the source mark rather than by being hidden in separate tabs: the
 * merchant should see their whole day in one place and know which numbers are proven.
 *
 * What comes back is decided by RLS, so a staff member sees only their own rows without
 * this screen asking about roles.
 */
export default function Transactions() {
  const insets = useSafeAreaInsets();
  const { t, i18n } = useTranslation();
  const { data, isLoading, isError, refetch, isRefetching } = useTransactions();
  const active = useActiveBusiness();
  const [filter, setFilter] = useState("all");
  const bangla = i18n.language === "bn";
  const receiptLink = useReceiptLink();

  // Tap a transaction to share its public receipt. Only rows with a receipt (QR payments)
  // produce a link; others do nothing.
  async function shareReceipt(txnId: string) {
    try {
      const url = await receiptLink.mutateAsync(txnId);
      if (url) await Share.share({ message: url });
    } catch {
      // A share cancelled or a row without a receipt is a no-op.
    }
  }

  // Which rows have been reversed, so the originals can be marked in one pass.
  const reversedIds = useMemo(
    () => new Set((data ?? []).map((r) => r.reverses_txn_id).filter(Boolean) as string[]),
    [data],
  );

  const timeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(bangla ? "bn-BD" : "en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        day: "2-digit",
        month: "short",
        timeZone: "Asia/Dhaka",
      }),
    [bangla],
  );

  const title = (row: TransactionRow) => {
    const kindLabel = t(`txn_kind.${row.kind}`, { defaultValue: row.kind });
    return row.note?.trim() || row.category?.trim() || row.reference?.trim() || kindLabel;
  };
  const filtered = useMemo(() => {
    if (filter === "all") return data ?? [];
    if (filter === "manual") return (data ?? []).filter((row) => row.source === "manual");
    return (data ?? []).filter((row) => row.kind === filter);
  }, [data, filter]);

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg, paddingTop: insets.top }}>
      <Text
        style={{
          fontSize: tokens.font.size.title,
          fontWeight: "700",
          color: tokens.color.text,
          paddingHorizontal: tokens.space[4],
          paddingVertical: tokens.space[3],
        }}
      >
        {t("nav.transactions")}
      </Text>

      {(
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: tokens.space[2], paddingHorizontal: tokens.space[4], paddingBottom: tokens.space[3] }}>
          {(active?.type === "AGENT" ? [
            ["all", t("agent.filter_all")],
            ["AGENT_CASH_IN", t("txn_kind.AGENT_CASH_IN")],
            ["AGENT_CASH_OUT", t("txn_kind.AGENT_CASH_OUT")],
            ["AGENT_SEND_MONEY", t("txn_kind.AGENT_SEND_MONEY")],
            ["AGENT_COMMISSION", t("txn_kind.AGENT_COMMISSION")],
            ["manual", t("transactions.manual")],
          ] : [
            ["all", t("agent.filter_all")],
            ["QR_PAYMENT", t("txn_kind.QR_PAYMENT")],
            ["CASH_SALE", t("txn_kind.CASH_SALE")],
            ["EXPENSE", t("txn_kind.EXPENSE")],
            ["BAKI_SALE", t("txn_kind.BAKI_SALE")],
            ["BAKI_COLLECTION", t("txn_kind.BAKI_COLLECTION")],
          ]).map(([key, label]) => (
            <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected: filter === key }} onPress={() => setFilter(key)} style={{ minHeight: tokens.touchMin, justifyContent: "center", paddingHorizontal: tokens.space[3], borderRadius: tokens.radius.pill, borderWidth: filter === key ? 2 : 1, borderColor: filter === key ? tokens.color.brandPrimary : tokens.color.divider, backgroundColor: tokens.color.surface }}>
              <Text style={{ color: filter === key ? tokens.color.brandPrimary : tokens.color.text, fontWeight: filter === key ? "700" : "400" }}>{label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {isLoading ? (
        <View style={{ paddingTop: tokens.space[6] }}>
          <ActivityIndicator color={tokens.color.brandPrimary} />
        </View>
      ) : isError ? (
        <ErrorState onRetry={() => void refetch()} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(row) => row.id}
          refreshing={isRefetching}
          onRefresh={() => void refetch()}
          ListEmptyComponent={
            <EmptyState
              icon="="
              title={t("empty.transactions")}
              subtitle={t("empty.transactions_sub")}
            />
          }
          renderItem={({ item }) => (
            <TxnRow
              title={title(item)}
              amountMinor={Number(item.amount_minor)}
              time={timeFormatter.format(new Date(item.occurred_at))}
              source={item.source}
              manualLabel={t("transactions.manual")}
              reversedLabel={reversedIds.has(item.id) ? t("transactions.reversed") : undefined}
              bangla={bangla}
              onPress={() => void shareReceipt(item.id)}
            />
          )}
        />
      )}
    </View>
  );
}
