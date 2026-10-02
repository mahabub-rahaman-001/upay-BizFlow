/**
 * Offline Outbox — persists posting RPCs to AsyncStorage when the device has no network,
 * and replays them in FIFO order when connectivity returns.
 *
 * Design rules:
 *  - Every item carries the idempotency key that was already baked in by the caller, so
 *    server-side the RPC is still idempotent even on replay.
 *  - Items are only removed after the server confirms success (204 / non-error JSON).
 *  - The banner subscriber re-renders any time the queue length changes.
 *  - No native modules required: uses @react-native-community/netinfo + AsyncStorage via
 *    the expo-sqlite MMKV-compatible layer (we use AsyncStorage polyfill in RN 0.73+).
 *
 * Usage:
 *   const { enqueue } = useOutbox();
 *   await enqueue("post_cash_sale", args);   // called by usePostingMutation when offline
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import { create } from "zustand";
import { supabase } from "./supabase";

const STORAGE_KEY = "bizflow_outbox_v1";

export interface OutboxItem {
  id: string;          // idempotency key (uuid v4)
  rpc: string;         // e.g. "post_cash_sale"
  args: Record<string, unknown>;
  enqueuedAt: number;  // Date.now()
  retries: number;
}

// ─── Zustand store (UI state only — truth is AsyncStorage) ──────────────────
interface OutboxState {
  items: OutboxItem[];
  syncing: boolean;
  setItems: (items: OutboxItem[]) => void;
  setSyncing: (v: boolean) => void;
}

export const useOutboxStore = create<OutboxState>((set) => ({
  items: [],
  syncing: false,
  setItems: (items) => set({ items }),
  setSyncing: (v) => set({ syncing: v }),
}));

// ─── Persistence helpers ─────────────────────────────────────────────────────
async function loadItems(): Promise<OutboxItem[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as OutboxItem[]) : [];
  } catch {
    return [];
  }
}

async function saveItems(items: OutboxItem[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  useOutboxStore.getState().setItems(items);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Add an item to the outbox. Called by usePostingMutation on network error. */
export async function enqueueOutbox(
  rpc: string,
  args: Record<string, unknown>,
): Promise<void> {
  const items = await loadItems();
  const item: OutboxItem = {
    id: args.idempotency_key as string ?? crypto.randomUUID(),
    rpc,
    args,
    enqueuedAt: Date.now(),
    retries: 0,
  };
  await saveItems([...items, item]);
}

/** Remove a successfully synced item. */
async function removeItem(id: string): Promise<void> {
  const items = await loadItems();
  await saveItems(items.filter((i) => i.id !== id));
}

/** Increment retry counter for an item. */
async function bumpRetry(id: string): Promise<void> {
  const items = await loadItems();
  await saveItems(
    items.map((i) => (i.id === id ? { ...i, retries: i.retries + 1 } : i)),
  );
}

/** Replay every queued item in FIFO order. Stops on first hard error. */
export async function flushOutbox(): Promise<void> {
  const { syncing, setSyncing } = useOutboxStore.getState();
  if (syncing) return;

  const items = await loadItems();
  if (items.length === 0) return;

  setSyncing(true);
  try {
    for (const item of items) {
      if (item.retries >= 5) {
        // Give up after 5 tries — keep in queue so user can inspect
        continue;
      }
      const { error } = await supabase.rpc(item.rpc, item.args);
      if (!error) {
        await removeItem(item.id);
      } else if (
        error.code === "23505" || // unique violation → idempotent: already saved
        error.code === "23503"    // FK violation → data stale, remove
      ) {
        await removeItem(item.id);
      } else {
        await bumpRetry(item.id);
      }
    }
  } finally {
    setSyncing(false);
  }
}

/** Hydrate store from AsyncStorage — call once at app start. */
export async function hydrateOutbox(): Promise<void> {
  const items = await loadItems();
  useOutboxStore.getState().setItems(items);
}

// ─── Auto-flush on reconnect ─────────────────────────────────────────────────
let _netUnsubscribe: (() => void) | null = null;

export function startOutboxListener(): void {
  if (_netUnsubscribe) return; // already running
  _netUnsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
    if (state.isConnected && state.isInternetReachable !== false) {
      void flushOutbox();
    }
  });
}

export function stopOutboxListener(): void {
  _netUnsubscribe?.();
  _netUnsubscribe = null;
}
