import { create } from "zustand";
import type { MemberRole } from "@bizflow/shared";
import { accountType, type Entrance } from "./roles";

export interface BusinessMembership {
  business_id: string;
  type: "MERCHANT" | "AGENT";
  name: string;
  category: string;
  upay_account_ref?: string | null;
  verified: boolean;
  status: string;
  role: MemberRole;
  permissions: Record<string, unknown>;
}

interface SessionState {
  verifying: boolean;
  entrance: Entrance | null;
  loginError: string | null;
  chooseEntrance: (entrance: Entrance | null) => void;
  setLoginError: (error: string | null) => void;
  /** Null until the user has signed in and me() has returned. */
  userId: string | null;
  businesses: BusinessMembership[];
  /** The business every screen and every RPC call is scoped to. */
  activeBusinessId: string | null;
  setSession: (userId: string, businesses: BusinessMembership[]) => void;
  setActiveBusiness: (businessId: string) => void;
  clear: () => void;
}

/**
 * Client-side session state. It mirrors what me() returned so the shell can decide which
 * tabs to show, nothing more: the server re-checks membership and role on every RPC, so
 * anything here is a convenience and never a permission (docs/02 section 7).
 */
export const useSession = create<SessionState>((set) => ({
  verifying: false,
  entrance: null,
  loginError: null,
  chooseEntrance: (entrance) => set({ entrance, loginError: null }),
  setLoginError: (loginError) => set({ loginError }),
  userId: null,
  businesses: [],
  activeBusinessId: null,
  setSession: (userId, businesses) => {
    accountType(businesses);
    set((prev) => ({
      userId,
      businesses,
      // Keep the chosen business across refreshes if the user still belongs to it.
      activeBusinessId:
        prev.activeBusinessId &&
        businesses.some((b) => b.business_id === prev.activeBusinessId)
          ? prev.activeBusinessId
          : (businesses[0]?.business_id ?? null),
    }));
  },
  setActiveBusiness: (businessId) => set((state) => ({
    activeBusinessId: state.businesses.some((b) => b.business_id === businessId)
      ? businessId : state.activeBusinessId,
  })),
  clear: () => set({ userId: null, businesses: [], activeBusinessId: null }),
}));

/** The active membership, or null before a business is chosen. */
export function useActiveBusiness(): BusinessMembership | null {
  const { businesses, activeBusinessId } = useSession();
  return businesses.find((b) => b.business_id === activeBusinessId) ?? null;
}

/** Whether the active member may add entries: owners and managers always, staff by toggle. */
export function useCanAddEntries(): boolean {
  const active = useActiveBusiness();
  if (!active) return false;
  if (active.role === "staff") return active.permissions.can_add_entries === true;
  return ["merchant_owner", "agent_owner", "manager"].includes(active.role);
}

/** Owner-only capabilities: reversals, withdrawals, staff and security settings. */
export function useIsOwner(): boolean {
  const active = useActiveBusiness();
  return active?.role === "merchant_owner" || active?.role === "agent_owner";
}

export type BusinessType = "MERCHANT" | "AGENT";

/** True when the active business is of the given type. */
export function useIsType(type: BusinessType): boolean {
  return useActiveBusiness()?.type === type;
}
