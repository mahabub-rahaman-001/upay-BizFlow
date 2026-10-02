import { useEffect } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { tokens } from "@bizflow/ui";
import { useActiveBusiness, type BusinessType } from "../lib/session";

/**
 * Wraps a screen that belongs to one business type. One account is one role (a person is a
 * merchant or an agent, never both), so an agent must never reach a merchant screen and the
 * reverse - not through a tab, a deep link, or a typed URL. A screen of the wrong type sends
 * the user back home instead of rendering.
 *
 * The server still enforces every rule by role on each RPC, so this is navigation hygiene,
 * not the security boundary: it keeps the two experiences cleanly apart (docs/02 section 7).
 */
export function RoleGuard({
  type,
  children,
}: {
  type: BusinessType;
  children: React.ReactNode;
}) {
  const active = useActiveBusiness();
  const router = useRouter();

  const allowed = active?.type === type;

  useEffect(() => {
    if (active && active.type !== type) {
      router.replace("/");
    }
  }, [active, type, router]);

  // Render nothing while redirecting, so the wrong-role screen never flashes.
  if (!allowed) {
    return <View style={{ flex: 1, backgroundColor: tokens.color.bg }} />;
  }

  return <>{children}</>;
}
