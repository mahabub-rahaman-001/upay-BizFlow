/**
 * Outbox unit test (P10). Verifies the offline queue actually works: an item enqueued
 * while offline is replayed when flush runs, and only removed once the server confirms it.
 * Deps are mocked so this runs without a device or network.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory AsyncStorage.
const store = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: (k: string) => Promise.resolve(store.get(k) ?? null),
    setItem: (k: string, v: string) => { store.set(k, v); return Promise.resolve(); },
  },
}));
vi.mock("@react-native-community/netinfo", () => ({
  default: { addEventListener: () => () => {}, fetch: () => Promise.resolve({ isConnected: true }) },
}));

// A controllable fake RPC.
const rpcMock = vi.fn();
vi.mock("../lib/supabase", () => ({ supabase: { rpc: (...a: unknown[]) => rpcMock(...a) } }));

// Imported after the vi.mock calls on purpose: the mocks must register before the module
// under test pulls in its dependencies.
// eslint-disable-next-line import/first
import { enqueueOutbox, flushOutbox, useOutboxStore } from "../lib/outbox";

describe("offline outbox", () => {
  beforeEach(() => {
    store.clear();
    rpcMock.mockReset();
    useOutboxStore.setState({ items: [], syncing: false });
  });

  it("queues a posting while offline", async () => {
    await enqueueOutbox("post_cash_sale", { p_business_id: "b1", p_client_uuid: "u1", p_amount_minor: 50000 });
    expect(useOutboxStore.getState().items).toHaveLength(1);
    expect(useOutboxStore.getState().items[0].rpc).toBe("post_cash_sale");
  });

  it("replays and removes the item once the server confirms", async () => {
    await enqueueOutbox("post_cash_sale", { p_business_id: "b1", p_client_uuid: "u1", p_amount_minor: 50000 });
    rpcMock.mockResolvedValue({ error: null });

    await flushOutbox();

    expect(rpcMock).toHaveBeenCalledWith("post_cash_sale", expect.objectContaining({ p_client_uuid: "u1" }));
    expect(useOutboxStore.getState().items).toHaveLength(0);
  });

  it("keeps the item and counts a retry on a transient error", async () => {
    await enqueueOutbox("post_cash_sale", { p_business_id: "b1", p_client_uuid: "u1", p_amount_minor: 50000 });
    rpcMock.mockResolvedValue({ error: { code: "08006", message: "connection lost" } });

    await flushOutbox();

    const items = useOutboxStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].retries).toBe(1);
  });

  it("drops a duplicate (unique violation) as already saved", async () => {
    await enqueueOutbox("post_cash_sale", { p_business_id: "b1", p_client_uuid: "u1", p_amount_minor: 50000 });
    rpcMock.mockResolvedValue({ error: { code: "23505", message: "duplicate key" } });

    await flushOutbox();

    expect(useOutboxStore.getState().items).toHaveLength(0);
  });
});
