import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { MoneyText, tokens } from "@bizflow/ui";
import { useBalances, useTodayInsights } from "../../lib/api";
import { useActiveBusiness, useCanAddEntries } from "../../lib/session";
import { InsightIcon } from "../../components/InsightIcon";
import { AppIcon, type AppIconName } from "../../components/AppIcon";

interface Shortcut {
  key: string;
  icon: AppIconName;
  label: string;
  route: Href;
}

/** A compact daily cockpit: attention first, money second, frequent work third. */
export default function Home() {
  const insets = useSafeAreaInsets();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const active = useActiveBusiness();
  const canAdd = useCanAddEntries();
  const balances = useBalances();
  const insights = useTodayInsights();
  const bangla = i18n.language === "bn";
  const isAgent = active?.type === "AGENT";
  const manager = active?.role === "merchant_owner" || active?.role === "agent_owner" || active?.role === "manager";
  const balanceOf = (code: string) => Number(balances.data?.find((b) => b.code === code)?.balance_minor ?? 0);
  const cash = balanceOf("1000");
  const digital = balanceOf("1010");
  const insightPayload = insights.data;
  const cards = insightPayload && insightPayload.role === active?.type ? insightPayload.cards : [];
  const visibleInsights = cards.slice(0, 2);
  const allowedRoutes = isAgent
    ? ["/books", "/transactions", "/agent-audit", "/commission"]
    : ["/books", "/transactions", "/planner", "/review", "/suppliers", "/baki"];

  const merchantShortcuts: Shortcut[] = [
    ...(canAdd ? [{ key: "sale", icon: "sale" as const, label: t("cash_sale.title"), route: "/cash-sale" as Href }] : []),
    { key: "expense", icon: "expense", label: t("expense.title"), route: "/expense" },
    { key: "baki", icon: "books", label: t("baki.title"), route: "/baki" },
    ...(manager ? [{ key: "closing", icon: "closing" as const, label: t("closing.title"), route: "/closing" as Href }] : []),
    { key: "suppliers", icon: "suppliers", label: t("suppliers.title"), route: "/suppliers" },
    { key: "planner", icon: "planner", label: t("planner.title"), route: "/planner" },
  ];
  const agentShortcuts: Shortcut[] = [
    ...(canAdd ? [{ key: "wallet", icon: "wallet" as const, label: t("agent.manual_wallet"), route: "/manual-wallet" as Href }] : []),
    { key: "transactions", icon: "transactions", label: t("nav.transactions"), route: "/transactions" },
    { key: "float", icon: "books", label: t("nav.float"), route: "/books" },
    ...(manager ? [{ key: "audit", icon: "audit" as const, label: t("agent.audit_title"), route: "/agent-audit" as Href }] : []),
    { key: "commission", icon: "commission", label: t("agent.commission"), route: "/commission" },
    { key: "reports", icon: "reports", label: t("reports.title"), route: "/reports" },
  ];
  const shortcuts = (isAgent ? agentShortcuts : merchantShortcuts).slice(0, 6);

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.bg, paddingTop: insets.top }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={insights.isRefetching} tintColor={tokens.color.brandPrimary} onRefresh={() => { void insights.refetch(); void balances.refetch(); }} />}
        contentContainerStyle={{ paddingHorizontal: tokens.space[4], paddingTop: tokens.space[3], paddingBottom: tokens.space[7], gap: tokens.space[4] }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: tokens.space[3] }}>
          <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: tokens.color.brandPrimary, alignItems: "center", justifyContent: "center" }}>
            <AppIcon name={isAgent ? "agent" : "store"} color={tokens.color.surface} size={23} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: tokens.font.size.caption, color: tokens.color.textMuted }}>{t(isAgent ? "home.agent_account" : "home.merchant_account")}</Text>
            <Text accessibilityRole="header" numberOfLines={1} style={{ fontSize: tokens.font.size.title, fontWeight: "700", color: tokens.color.text }}>{active?.name}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("settings.open")}
            onPress={() => router.push("/settings")}
            style={({ pressed }) => ({ width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 15, borderWidth: 1, borderColor: tokens.color.divider, backgroundColor: pressed ? tokens.color.brandSoft : tokens.color.surface })}
          >
            <AppIcon name="settings" color={tokens.color.brandPrimary} size={22} />
          </Pressable>
        </View>

        <View style={{ gap: tokens.space[2] }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={{ flex: 1, fontSize: tokens.font.size.label, fontWeight: "700", color: tokens.color.text }}>{t("home.attention_today")}</Text>
            {cards.length > 2 ? <Text style={{ fontSize: tokens.font.size.caption, color: tokens.color.textMuted }}>+{cards.length - 2}</Text> : null}
          </View>
          {insights.isLoading ? (
            <CompactMessage><ActivityIndicator color={tokens.color.aiBorder} /></CompactMessage>
          ) : insights.isError ? (
            <CompactMessage><Text accessibilityRole="alert" style={{ color: tokens.color.statusBad }}>{t("insights.error")}</Text></CompactMessage>
          ) : visibleInsights.length === 0 ? (
            <CompactMessage><Text style={{ color: tokens.color.textMuted }}>{t("insights.empty")}</Text></CompactMessage>
          ) : (
            <View style={{ gap: tokens.space[2] }}>
              {visibleInsights.map((card) => {
                const route = card.action_route && allowedRoutes.includes(card.action_route) ? card.action_route as Href : null;
                const tone = card.severity === "bad" ? tokens.color.statusBad : card.severity === "warn" ? tokens.color.statusWarn : tokens.color.aiBorder;
                return (
                  <Pressable
                    key={card.id}
                    accessibilityRole={route ? "button" : undefined}
                    onPress={route ? () => router.push(route) : undefined}
                    style={({ pressed }) => ({ minHeight: 58, flexDirection: "row", alignItems: "center", gap: tokens.space[3], paddingHorizontal: tokens.space[3], paddingVertical: tokens.space[2], borderRadius: tokens.radius.md, backgroundColor: pressed ? tokens.color.brandSoft : tokens.color.aiTint, borderLeftWidth: 3, borderLeftColor: tone })}
                  >
                    <View style={{ width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: tokens.color.surface }}>
                      <InsightIcon name={card.icon} />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text numberOfLines={1} style={{ color: tokens.color.text, fontSize: tokens.font.size.label, fontWeight: "700" }}>{bangla ? card.title_bn : card.title_en}</Text>
                      <Text numberOfLines={1} style={{ color: tokens.color.textMuted, fontSize: tokens.font.size.caption }}>{bangla ? card.body_bn : card.body_en}</Text>
                    </View>
                    {route ? <AppIcon name="chevron" color={tokens.color.textMuted} size={17} /> : null}
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        <View style={{ overflow: "hidden", borderRadius: tokens.radius.lg, backgroundColor: tokens.color.brandPrimary }}>
          <View style={{ padding: tokens.space[5], gap: tokens.space[2] }}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text style={{ flex: 1, fontSize: tokens.font.size.label, color: "#D8E6EF" }}>{t(isAgent ? "home.float_and_cash" : "home.money_on_hand")}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: tokens.space[1] }}>
                <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: "#79D6A7" }} />
                <Text style={{ fontSize: tokens.font.size.caption, color: "#D8E6EF" }}>{t("home.live_balance")}</Text>
              </View>
            </View>
            {balances.isLoading ? (
              <ActivityIndicator color={tokens.color.surface} style={{ alignSelf: "flex-start", marginVertical: 9 }} />
            ) : balances.isError ? (
              <Text style={{ color: "#FFD4CC" }}>{t("insights.error")}</Text>
            ) : (
              <MoneyText amountMinor={cash + digital} size="numberXl" bangla={bangla} style={{ color: tokens.color.surface, letterSpacing: -1 }} />
            )}
          </View>
          <View style={{ flexDirection: "row", backgroundColor: "#0D3457", borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.12)" }}>
            <BalancePart icon="cash" label={t("home.cash")} amount={cash} bangla={bangla} />
            <View style={{ width: 1, backgroundColor: "rgba(255,255,255,0.12)" }} />
            <BalancePart icon="digital" label={t(isAgent ? "home.e_float" : "home.digital")} amount={digital} bangla={bangla} />
          </View>
        </View>

        <View style={{ gap: tokens.space[3] }}>
          <View style={{ flexDirection: "row", alignItems: "baseline" }}>
            <Text style={{ flex: 1, fontSize: tokens.font.size.body, fontWeight: "700", color: tokens.color.text }}>{t("home.quick_actions")}</Text>
            <Text style={{ fontSize: tokens.font.size.caption, color: tokens.color.textMuted }}>{t("home.tap_to_open")}</Text>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", marginHorizontal: -4 }}>
            {shortcuts.map((item) => (
              <View key={item.key} style={{ width: "33.333%", padding: 4 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                  onPress={() => router.push(item.route)}
                  style={({ pressed }) => ({ minHeight: 104, alignItems: "center", justifyContent: "center", gap: tokens.space[2], borderRadius: tokens.radius.md, backgroundColor: pressed ? tokens.color.brandSoft : tokens.color.surface, borderWidth: 1, borderColor: pressed ? tokens.color.brandPrimary : tokens.color.divider, transform: [{ scale: pressed ? 0.98 : 1 }] })}
                >
                  <View style={{ width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: tokens.color.brandSoft }}>
                    <AppIcon name={item.icon} color={tokens.color.brandPrimary} size={23} />
                  </View>
                  <Text numberOfLines={2} style={{ minHeight: 36, paddingHorizontal: 4, textAlign: "center", fontSize: tokens.font.size.caption, fontWeight: "600", lineHeight: 18, color: tokens.color.text }}>{item.label}</Text>
                </Pressable>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function CompactMessage({ children }: { children: React.ReactNode }) {
  return <View style={{ minHeight: 58, justifyContent: "center", paddingHorizontal: tokens.space[3], borderRadius: tokens.radius.md, backgroundColor: tokens.color.aiTint }}>{children}</View>;
}

function BalancePart({ icon, label, amount, bangla }: { icon: "cash" | "digital"; label: string; amount: number; bangla: boolean }) {
  return (
    <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: tokens.space[2], padding: tokens.space[3] }}>
      <AppIcon name={icon} color="#BBD4E4" size={20} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: tokens.font.size.caption, color: "#BBD4E4" }}>{label}</Text>
        <MoneyText amountMinor={amount} bangla={bangla} style={{ color: tokens.color.surface, fontSize: tokens.font.size.label }} />
      </View>
    </View>
  );
}
