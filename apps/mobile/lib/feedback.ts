/**
 * Haptics and sound for meaningful moments (docs/16 section 8.3). Every screen calls
 * feedback(event); nothing else in the app vibrates or plays a sound.
 *
 * Rules kept here, not at call sites:
 * - sound only for success, PIN/security and error events, never for taps or navigation
 * - haptics are light for taps, medium for success, a warning pattern for errors
 * - both can be switched off independently in Settings, and are on by default
 *
 * Drivers: Android vibration and web vibration for haptics, Web Audio tones for sound on
 * web. Native sound and iOS haptics plug in here once expo-audio / expo-haptics are
 * installed (see docs/16).
 */
import { useEffect, useState } from "react";
import { AccessibilityInfo, Platform, Vibration } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { setUiFeedback } from "@bizflow/ui";

export type FeedbackEvent =
  | "tap"        // primary button, tile, toggle, filter, tab: light haptic, no sound
  | "success"    // payment received, entry saved, day closed: medium haptic + chime
  | "security"   // PIN accepted, PIN reset, signed in: light haptic + soft tick
  | "error";     // failed action, mismatch, wrong PIN: warning haptic + low tone

const SETTINGS_KEY = "bizflow.feedback";

interface FeedbackSettings {
  sound: boolean;
  haptics: boolean;
  setSound: (on: boolean) => void;
  setHaptics: (on: boolean) => void;
}

export const useFeedbackSettings = create<FeedbackSettings>((set, get) => ({
  sound: true,
  haptics: true,
  setSound: (sound) => { set({ sound }); save(get()); },
  setHaptics: (haptics) => { set({ haptics }); save(get()); },
}));

function save(state: FeedbackSettings) {
  void AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ sound: state.sound, haptics: state.haptics })).catch(() => undefined);
}

/** Load the saved switches and register the press bridge for shared components. Call once. */
export async function initFeedback() {
  setUiFeedback((event: "tap") => feedback(event));
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as { sound?: boolean; haptics?: boolean };
      useFeedbackSettings.setState({ sound: saved.sound !== false, haptics: saved.haptics !== false });
    }
  } catch {
    // Defaults stay on.
  }
}

export function feedback(event: FeedbackEvent) {
  const { sound, haptics } = useFeedbackSettings.getState();
  if (haptics) vibrate(event);
  if (sound && event !== "tap") playTone(event);
}

// ---------------------------------------------------------------------------
// Haptics
// ---------------------------------------------------------------------------

const PATTERNS: Record<FeedbackEvent, number | number[]> = {
  tap: 8,
  security: 12,
  success: [0, 18, 70, 18],
  error: [0, 30, 60, 30, 60, 30],
};

function vibrate(event: FeedbackEvent) {
  try {
    if (Platform.OS === "web") {
      const nav = globalThis.navigator as (Navigator & { userActivation?: { hasBeenActive: boolean } }) | undefined;
      // Browsers refuse vibration before the first tap; do not ask until then.
      if (nav?.userActivation?.hasBeenActive) nav.vibrate?.(PATTERNS[event]);
    } else if (Platform.OS === "android") {
      Vibration.vibrate(PATTERNS[event]);
    }
    // iOS: the system Vibration API only offers a long buzz, which is wrong for a tap;
    // iOS haptics arrive with expo-haptics.
  } catch {
    // Haptics are a courtesy; never let them break an action.
  }
}

// ---------------------------------------------------------------------------
// Sound: tiny synthesized tones, low volume, under 300 ms
// ---------------------------------------------------------------------------

type ToneStep = { freq: number; at: number; length: number };

const TONES: Record<Exclude<FeedbackEvent, "tap">, ToneStep[]> = {
  // Two soft rising notes: "done".
  success: [{ freq: 784, at: 0, length: 0.12 }, { freq: 1046, at: 0.09, length: 0.18 }],
  // One short tick.
  security: [{ freq: 880, at: 0, length: 0.07 }],
  // A low, gentle two-step down; never an alarm.
  error: [{ freq: 330, at: 0, length: 0.12 }, { freq: 262, at: 0.11, length: 0.16 }],
};

interface MinimalAudioContext {
  currentTime: number;
  destination: unknown;
  state: string;
  resume: () => Promise<void>;
  createOscillator: () => { type: string; frequency: { value: number }; connect: (n: unknown) => void; start: (t: number) => void; stop: (t: number) => void };
  createGain: () => { gain: { setValueAtTime: (v: number, t: number) => void; exponentialRampToValueAtTime: (v: number, t: number) => void }; connect: (n: unknown) => void };
}

let audio: MinimalAudioContext | null = null;

function playTone(event: Exclude<FeedbackEvent, "tap">) {
  if (Platform.OS !== "web") return;
  try {
    const Ctor = (globalThis as unknown as { AudioContext?: new () => MinimalAudioContext; webkitAudioContext?: new () => MinimalAudioContext }).AudioContext
      ?? (globalThis as unknown as { webkitAudioContext?: new () => MinimalAudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audio ??= new Ctor();
    if (audio.state === "suspended") void audio.resume();
    const now = audio.currentTime;
    for (const step of TONES[event]) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = "sine";
      osc.frequency.value = step.freq;
      gain.gain.setValueAtTime(0.0001, now + step.at);
      gain.gain.exponentialRampToValueAtTime(0.06, now + step.at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + step.at + step.length);
      osc.connect(gain);
      gain.connect(audio.destination);
      osc.start(now + step.at);
      osc.stop(now + step.at + step.length + 0.02);
    }
  } catch {
    // Sound is optional feedback; a blocked audio context is fine.
  }
}

// ---------------------------------------------------------------------------
// Reduced motion
// ---------------------------------------------------------------------------

let reduceMotion = false;
const motionListeners = new Set<(on: boolean) => void>();
void AccessibilityInfo.isReduceMotionEnabled?.().then((on) => { reduceMotion = !!on; motionListeners.forEach((l) => l(reduceMotion)); }).catch(() => undefined);
AccessibilityInfo.addEventListener?.("reduceMotionChanged", (on: boolean) => { reduceMotion = on; motionListeners.forEach((l) => l(on)); });

/** True when the system asks for less motion: animations become fades or jumps. */
export function useReducedMotion(): boolean {
  const [on, setOn] = useState(reduceMotion);
  useEffect(() => {
    motionListeners.add(setOn);
    return () => { motionListeners.delete(setOn); };
  }, []);
  return on;
}

export function isReducedMotion() {
  return reduceMotion;
}
