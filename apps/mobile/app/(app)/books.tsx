import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { ActionList, Card, MoneyText, StatusPill, tokens, type ActionItem } from "@bizflow/ui";
import { useAgentAuditPreview, useBalances, useClosingPreview, useWalletBreakdown } from "../../lib/api";
import { useActiveBusiness, useCanAddEntries, useIsOwner } from "../../lib/session";

/**
 * Books - the hub for everything the owner records by hand (docs/03 M4, M5, M8). Three
 * actions, as the UI rule allows, with closing on its own because it is the day's ritual
 * rather than another entry.
 *
 * An agent sees the float figures here instead; the agent-specific screens arrive in P5.
 */
export default function Books() {
  const insets = useSafeAreaInsets();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const active = useActiveBusiness();
  const canAddEntries = useCanAddEntries();
  const isOwner = useIsOwner();
  const { data: balances } = useBalances();
  const { data: closing, isLoading } = useClosingPreview();
  const bangla = i18n.language === "bn";

  const balanceOf = (code: string) =>
    Number(balances?.find((b) => b.code === code)?.balance_minor ?? 0);

  const isAgent = active?.type === "AGENT";
  const { data: agentAudit } = useAgentAuditPreview(isAgent);
  const walletBreakdown = useWalletBreakdown();
  const outstandingBaki = balanceOf("1100");
  const otherWallets = balanceOf("1030");

  const merchantActions: ActionItem[] = canAddEntries
    ? [
        {
          key: "cash-sale",
          icon: "+",
          label: t("cash_sale.title"),
          onPress: () => router.push("/cash-sale"),
        },
        {
          key: "expense",
          icon: "-",
          label: t("expense.title"),
          onPress: () => router.push("/expense"),
        },
        {
          key: "baki",
          icon: "B",
          label: t("baki.title"),
          onPress: () => router.push("/baki"),
        },
      ]
    : [];
  const agentActions: ActionItem[] = [
    ...(canAddEntries ? [{ key: "manual-wallet", icon: "+", label: t("agent.manual_wallet"), onPress: () => router.push("/manual-wallet") }] : []),
    ...(isOwner ? [
      { key: "agent-audit", icon: "=", label: t("agent.audit_title"), onPress: () => router.push("/agent-audit") },
      { key: "commission", icon: "%", label: t("agent.commission"), onPress: () => router.push("/commission") },
    ] : []),
  ];
  const actions = isAgent ? agentActions : merchantActions;

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
        {isAgent ? t("nav.float") : t("nav.books")}
      </Text>

      <ScrollView contentContainerStyle={{ padding: tokens.space[4], gap: tokens.space[3] }}>
        <Card title={isAgent ? t("home.e_float") : t("home.digital")}>
          <MoneyText amountMinor={balanceOf("1010")} size="numberLg" bangla={bangla} />
        </Card>

        <Card title={t("books.in_drawer")}>
          <MoneyText amountMinor={balanceOf("1000")} size="numberLg" bangla={bangla} />
        </Card>

        {isAgent ? (
          <Card title={t("agent.other_wallets")}>
            <MoneyText amountMinor={otherWallets} size="title" bangla={bangla} />
            <Text style={{ color: tokens.color.textMuted, fontSize: tokens.font.size.caption }}>
              {t("agent.manual")}
            </Text>
            {(walletBreakdown.data?.wallets ?? []).map((w) => (
              <View key={w.wallet} style={{ flexDirection: "row", justifyContent: "space-between", paddingTop: tokens.space[1] }}>
                <Text style={{ color: tokens.color.text, fontSize: tokens.font.size.label }}>{w.wallet}</Text>
                <MoneyText amountMinor={Number(w.total_minor)} bangla={bangla} muted />
              </View>
            ))}
          </Card>
        ) : null}

        {isAgent ? (
          <Card title={t("agent.commission_today")}>
            <MoneyText amountMinor={agentAudit?.commission_minor ?? 0} size="title" bangla={bangla} />
          </Card>
        ) : null}

        {isAgent ? (
          <Text style={{ color: tokens.color.textMuted, fontSize: tokens.font.size.label, lineHeight: 22 }}>
            {t("agent.movement_help")}
          </Text>
        ) : null}

        {!isAgent && outstandingBaki > 0 ? (
          <Card title={t("books.baki_outstanding")}>
            <MoneyText amountMinor={outstandingBaki} size="title" bangla={bangla} />
          </Card>
        ) : null}

        {actions.length > 0 ? <ActionList items={actions} /> : null}

        {/* Suppliers are a merchant, owner-or-manager feature; staff never see them. */}
        {!isAgent && (isOwner || active?.role === "manager") ? (
          <ActionList
            items={[
              {
                key: "suppliers",
                icon: "S",
                label: t("suppliers.title"),
                onPress: () => router.push("/suppliers"),
              },
            ]}
          />
        ) : null}

        {isOwner && !isAgent ? (
          <Card title={t("closing.title")}>
            {isLoading ? (
              <ActivityIndicator color={tokens.color.brandPrimary} />
            ) : closing?.already_closed ? (
              <StatusPill kind="good" icon="v" label={t("closing.done")} />
            ) : (
              <ActionList
                items={[
                  {
                    key: "closing",
                    icon: "*",
                    label: t("closing.close"),
                    onPress: () => router.push("/closing"),
                  },
                ]}
              />
            )}
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
}
