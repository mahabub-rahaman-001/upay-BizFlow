import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { Session } from "@supabase/supabase-js";
import { tokens } from "@bizflow/ui";
import { supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { accountType } from "../lib/roles";
import type { BusinessMembership } from "../lib/session";
import { i18nReady } from "../lib/i18n";
import { initFeedback } from "../lib/feedback";
import { getPinPhone, useAppLock } from "../lib/pin";
import { ToastHost } from "../components/kit";
import { PinLock, PinSetup, localPhone } from "../components/auth";

const queryClient = new QueryClient({
  defaultOptions: {
    // Shops work on patchy mobile data: keep served data a little longer and retry once.
    queries: { staleTime: 30 * 1000, retry: 1 },
  },
});

export default function RootLayout() {
  const [translationsReady, setTranslationsReady] = useState(false);

  useEffect(() => {
    void initFeedback();
    void i18nReady.finally(() => setTranslationsReady(true));
  }, []);

  if (!translationsReady) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: tokens.color.bg }}>
        <ActivityIndicator color={tokens.color.brandPrimary} />
      </View>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <AuthGate />
        <ToastHost />
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

/**
 * Sends the user to login or into the app depending on the Supabase session. This is
 * navigation only - every screen's data is still protected by RLS and the RPC role
 * checks, so a user who reached a screen they should not see still cannot read or write
 * anything (docs/02 section 7).
 */
function AuthGate() {
  const [session, setSupabaseSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const clearSession = useSession((s) => s.clear);
  const userId = useSession((s) => s.userId);
  const entrance = useSession((s) => s.entrance);
  const segments = useSegments();
  const router = useRouter();
  const lock = useAppLock((st) => st.state);
  const fresh = useAppLock((st) => st.fresh);
  const setLock = useAppLock((st) => st.set);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSupabaseSession(data.session);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      useSession.setState({ verifying: !!next && useSession.getState().userId !== next.user.id });
      setSupabaseSession(next);
      if (!next) {
        clearSession();
        queryClient.clear();
        useAppLock.setState({ state: "unknown", fresh: false });
      }
    });

    return () => subscription.subscription.unsubscribe();
  }, [clearSession]);

  useEffect(() => {
    if (!session || userId === session.user.id) return;
    let cancelled = false;
    void (async () => {
      try {
        const { data, error } = await supabase.rpc("me");
        if (cancelled) return;
        if (error) throw error;
        const payload = data as { user_id: string; businesses: BusinessMembership[] };
        const actual = accountType(payload.businesses);
        if (entrance && actual && actual !== entrance) {
          useSession.getState().setLoginError(`auth.use_${actual.toLowerCase()}_entrance`);
          await supabase.auth.signOut({ scope: "local" });
          return;
        }
        useSession.getState().setSession(payload.user_id, payload.businesses);
        useSession.setState({ verifying: false });
        queryClient.setQueryData(["me"], payload);
      } catch {
        if (cancelled) return;
        useSession.getState().setLoginError("auth.account_unavailable");
        await supabase.auth.signOut({ scope: "local" });
      }
    })();
    return () => { cancelled = true; };
  }, [session, userId, entrance]);

  // Decide the app lock once the account is known: a returning device asks for the PIN,
  // a device without one (or right after a PIN reset) creates it, and a sign-in that just
  // passed OTP in this run is not asked again (docs/16 section 6).
  useEffect(() => {
    if (!session || userId !== session.user.id || lock !== "unknown") return;
    void getPinPhone().then((pinPhone) => {
      if (pinPhone && pinPhone === localPhone(session.user.phone)) setLock(fresh ? "unlocked" : "locked");
      else setLock("needs-pin");
    });
  }, [session, userId, lock, fresh, setLock]);

  useEffect(() => {
    if (loading) return;
    const inAuthGroup = segments[0] === "(auth)";
    if (segments[0] === "admin") return;

    if (!session && !inAuthGroup) {
      router.replace("/login");
    } else if (session && userId === session.user.id && inAuthGroup) {
      router.replace("/");
    }
  }, [session, userId, loading, segments, router]);

  if (loading || (segments[0] !== "(auth)" && segments[0] !== "admin" && (!session || userId !== session.user.id))) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: tokens.color.bg,
        }}
      >
        <ActivityIndicator color={tokens.color.brandPrimary} />
      </View>
    );
  }

  if (session && userId === session.user.id && segments[0] !== "admin") {
    if (lock === "unknown") return <View style={{ flex: 1, backgroundColor: tokens.color.bg }} />;
    if (lock === "locked") return <PinLock phone={session.user.phone ? `+${session.user.phone.replace(/^\+/, "")}` : ""} />;
    if (lock === "needs-pin") return <PinSetup phone={session.user.phone ?? ""} onDone={() => setLock("unlocked")} />;
  }

  return <Stack screenOptions={{ headerShown: false, animation: "default", contentStyle: { backgroundColor: tokens.color.bg } }} />;
}
