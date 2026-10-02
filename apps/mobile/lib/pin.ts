/**
 * The device PIN (docs/16 section 6). OTP proves the phone number once; afterwards a
 * five-digit PIN unlocks the app on this device, the way MFS apps work. The PIN never
 * leaves the device and is stored only as a salted, iterated SHA-256 hash. Five wrong
 * tries remove it, so the only way back is an OTP reset.
 */
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

export const PIN_LENGTH = 5;
export const MAX_PIN_ATTEMPTS = 5;
const KEY = "bizflow.pin";
const ITERATIONS = 1500;

interface PinRecord { phone: string; salt: string; hash: string; failed: number }

const store = {
  get: (k: string) => (Platform.OS === "web" ? AsyncStorage.getItem(k) : SecureStore.getItemAsync(k)),
  set: (k: string, v: string) => (Platform.OS === "web" ? AsyncStorage.setItem(k, v) : SecureStore.setItemAsync(k, v)),
  del: (k: string) => (Platform.OS === "web" ? AsyncStorage.removeItem(k) : SecureStore.deleteItemAsync(k)),
};

// --- SHA-256 (FIPS 180-4), small and dependency-free -------------------------
const K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256Hex(message: string): string {
  const bytes = new TextEncoder().encode(message);
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, bitLen >>> 0);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  const h = Uint32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h as unknown as number[];
    for (let i = 0; i < 64; i++) {
      const t1 = (hh! + (rotr(e!, 6) ^ rotr(e!, 11) ^ rotr(e!, 25)) + ((e! & f!) ^ (~e! & g!)) + K[i]! + w[i]!) >>> 0;
      const t2 = ((rotr(a!, 2) ^ rotr(a!, 13) ^ rotr(a!, 22)) + ((a! & b!) ^ (a! & c!) ^ (b! & c!))) >>> 0;
      hh = g; g = f; f = e; e = (d! + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0]! + a!) >>> 0; h[1] = (h[1]! + b!) >>> 0; h[2] = (h[2]! + c!) >>> 0; h[3] = (h[3]! + d!) >>> 0;
    h[4] = (h[4]! + e!) >>> 0; h[5] = (h[5]! + f!) >>> 0; h[6] = (h[6]! + g!) >>> 0; h[7] = (h[7]! + hh!) >>> 0;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, "0")).join("");
}

function derive(pin: string, salt: string): string {
  let out = sha256Hex(`${salt}:${pin}`);
  for (let i = 0; i < ITERATIONS; i++) out = sha256Hex(out + salt);
  return out;
}

/** Five digits, not all the same and not a straight run - the PINs people guess first. */
export function pinIsWeak(pin: string): boolean {
  if (!/^\d{5}$/.test(pin)) return true;
  if (/^(\d)\1{4}$/.test(pin)) return true;
  return "0123456789".includes(pin) || "9876543210".includes(pin);
}

async function read(): Promise<PinRecord | null> {
  try {
    const raw = await store.get(KEY);
    return raw ? (JSON.parse(raw) as PinRecord) : null;
  } catch {
    return null;
  }
}

export async function getPinPhone(): Promise<string | null> {
  return (await read())?.phone ?? null;
}

export async function setPin(phone: string, pin: string): Promise<void> {
  const salt = globalThis.crypto.randomUUID();
  await store.set(KEY, JSON.stringify({ phone, salt, hash: derive(pin, salt), failed: 0 }));
}

export async function clearPin(): Promise<void> {
  await store.del(KEY);
}

export type PinCheck = { ok: true } | { ok: false; attemptsLeft: number; locked: boolean };

export async function verifyPin(pin: string): Promise<PinCheck> {
  const record = await read();
  if (!record) return { ok: false, attemptsLeft: 0, locked: true };
  if (derive(pin, record.salt) === record.hash) {
    if (record.failed) await store.set(KEY, JSON.stringify({ ...record, failed: 0 }));
    return { ok: true };
  }
  const failed = record.failed + 1;
  if (failed >= MAX_PIN_ATTEMPTS) {
    await clearPin();
    return { ok: false, attemptsLeft: 0, locked: true };
  }
  await store.set(KEY, JSON.stringify({ ...record, failed }));
  return { ok: false, attemptsLeft: MAX_PIN_ATTEMPTS - failed, locked: false };
}

/**
 * App lock state. "unknown" until start-up has checked for a PIN; "locked" shows the PIN
 * screen over everything; "needs-pin" sends a signed-in user without a PIN to create one.
 */
type LockState = "unknown" | "locked" | "unlocked" | "needs-pin";
export const useAppLock = create<{
  state: LockState;
  /** True right after an OTP sign-in in this run: the PIN is not asked again. */
  fresh: boolean;
  set: (state: LockState) => void;
  markFresh: () => void;
}>((set) => ({
  state: "unknown",
  fresh: false,
  set: (state) => set({ state }),
  markFresh: () => set({ fresh: true, state: "unknown" }),
}));
