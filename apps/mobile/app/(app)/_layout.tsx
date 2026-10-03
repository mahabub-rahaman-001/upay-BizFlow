import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Redirect, Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { tokens } from "@bizflow/ui";
import { useMe } from "../../lib/api";
import { useActiveBusiness, useSession } from "../../lib/session";
import { hydrateOutbox, startOutboxListener, stopOutboxListener } from "../../lib/outbox";
import { feedback } from "../../lib/feedback";
import { OfflineBanner } from "../../components/OfflineBanner";
import { AppIcon, type AppIconName } from "../../components/AppIcon";
import { ErrorState, LoadingState } from "../../components/kit";

const c = tokens.color;

/**
 * The shell: five fixed tabs, icon and word on every one (docs/04 section 5), the raised
 * Receive button in the middle. Positions never change between roles; only the fourth
 * tab's meaning does (Books for a shop, Float for an agent).
 */
export default function AppLayout() {
  const { t } = useTranslation();
  const { isLoading, isError, refetch } = useMe();
  const businesses = useSession((s) => s.businesses);
  const active = useActiveBusiness();
  const setActiveBusiness = useSession((s) => s.setActiveBusiness);

  useEffect(() => {
    if (!active && businesses[0]) setActiveBusiness(businesses[0].business_id);
  }, [active, businesses, setActiveBusiness]);

  useEffect(() => {
    void hydrateOutbox();
    startOutboxListener();
    return () => stopOutboxListener();
  }, []);

  if (isLoading) return <View style={{ flex: 1, backgroundColor: c.bg, justifyContent: "center" }}><LoadingState /></View>;
  if (isError) return <View style={{ flex: 1, backgroundColor: c.bg, justifyContent: "center" }}><ErrorState onRetry={() => void refetch()} /></View>;
  if (businesses.length === 0) return <Redirect href="/onboarding" />;

  const isAgent = active?.type === "AGENT";
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <OfflineBanner />
      <Tabs screenOptions={{ headerShown: false, animation: "fade", sceneStyle: { backgroundColor: c.bg } }} tabBar={(props) => <TabBar {...props} />}>
        <Tabs.Screen name="index" options={{ title: t("nav.home") }} />
        <Tabs.Screen name="transactions" options={{ title: t("nav.transactions") }} />
        <Tabs.Screen name="receive" options={{ title: t("nav.receive") }} />
        <Tabs.Screen name="books" options={{ title: isAgent ? t("nav.float") : t("nav.books") }} />
        <Tabs.Screen name="offers" options={{ title: t("nav.offers") }} />
      </Tabs>
    </View>
  );
}

type BottomTabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>["tabBar"]>>[0];

const ICONS: Record<string, AppIconName> = { index: "home", transactions: "transactions", receive: "qr", books: "books", offers: "offers" };

function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const isAgent = useActiveBusiness()?.type === "AGENT";
  return (
    <View style={[s.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const label = String(descriptors[route.key]?.options.title ?? route.name);
        const raised = route.name === "receive";
        const icon = route.name === "books" && isAgent ? "float" : ICONS[route.name] ?? "home";
        const onPress = () => {
          const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) {
            feedback("tap");
            navigation.navigate(route.name);
          }
        };
        return (
          <Pressable key={route.key} accessibilityRole="tab" accessibilityState={{ selected: focused }} accessibilityLabel={label} onPress={onPress} style={s.item}>
            {raised ? (
              <View style={[s.raised, focused && { backgroundColor: c.brandPrimary }]}>
                <AppIcon name="qr" size={26} color={focused ? c.onBrand : c.actionPrimaryText} strokeWidth={2} />
              </View>
            ) : (
              <View style={[s.iconWrap, focused && s.iconWrapOn]}>
                <AppIcon name={icon} size={22} color={focused ? c.brandPrimary : c.textMuted} strokeWidth={focused ? 2.1 : 1.8} />
              </View>
            )}
            <Text numberOfLines={1} style={[s.label, focused && s.labelOn, raised && { marginTop: 2 }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: "row", backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.divider, paddingTop: 6, ...tokens.shadow.card, shadowOffset: { width: 0, height: -4 } },
  item: { flex: 1, alignItems: "center", justifyContent: "flex-end", minHeight: 54, gap: 2 },
  iconWrap: { width: 52, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  iconWrapOn: { backgroundColor: c.brandSoft },
  raised: { width: 56, height: 56, borderRadius: 20, marginTop: -26, backgroundColor: c.actionPrimary, alignItems: "center", justifyContent: "center", borderWidth: 4, borderColor: c.surface, ...tokens.shadow.raised },
  label: { fontSize: 11.5, lineHeight: 16, fontWeight: "600", color: c.textMuted },
  labelOn: { color: c.brandPrimary, fontWeight: "700" },
});
