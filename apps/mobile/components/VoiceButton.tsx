/**
 * VoiceButton - hold-to-talk that turns Bangla speech into a draft entry for confirmation.
 *
 * It uses the platform's own speech-to-text to get Bangla text, then sends that text to the
 * AI service /v1/ai/parse, which runs the Bangla number normalizer and rule classifier and
 * returns a structured draft (amount, kind, category). The draft is never auto-saved: the
 * screen shows it in a confirm modal first (docs/04 section 12.1, docs/08 AI-07).
 *
 * Speech recognition comes from the Web Speech API, which the demo runs on in the browser.
 * Where it is not available (a bare native build without an STT module), the button says so
 * and the user types instead - voice is a convenience, never the only way in.
 */

import { Animated, Easing, Modal, Pressable, Platform, Text, View } from "react-native";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { tokens } from "@bizflow/ui";
import { formatMoney } from "@bizflow/shared";

export interface VoiceDraft {
  amount_minor: number;
  note: string;
  category: string;
}

interface VoiceButtonProps {
  onDraft: (draft: VoiceDraft) => void;
  style?: object;
}

const AI_BASE = process.env.EXPO_PUBLIC_AI_SERVICE_URL ?? "http://localhost:8000";

// The Web Speech API constructor, if this platform has one.
function speechRecognitionCtor(): (new () => SpeechRecognition) | null {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function VoiceButton({ onDraft, style }: VoiceButtonProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<"idle" | "recording" | "processing" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const recognition = useRef<SpeechRecognition | null>(null);

  const pulse = useRef(new Animated.Value(1)).current;
  const pulseAnim = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (state === "recording") {
      pulseAnim.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.2, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1.0, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      );
      pulseAnim.current.start();
    } else {
      pulseAnim.current?.stop();
      Animated.timing(pulse, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    }
  }, [state, pulse]);

  async function parseText(text: string) {
    setState("processing");
    try {
      const res = await fetch(`${AI_BASE}/v1/ai/parse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, business_id: "" }),
      });
      if (!res.ok) throw new Error(await res.text());
      const parsed = (await res.json()) as {
        amount_minor: number | null;
        category: string | null;
        note: string | null;
      };
      setState("idle");
      onDraft({
        amount_minor: parsed.amount_minor ?? 0,
        category: parsed.category ?? "",
        // Keep what was said as the note when the parser could not name one.
        note: parsed.note ?? text,
      });
    } catch {
      setState("error");
      setErrorMsg(t("voice.error_parse"));
      setTimeout(() => setState("idle"), 3000);
    }
  }

  const handlePressIn = () => {
    setErrorMsg("");
    const Ctor = speechRecognitionCtor();
    if (!Ctor) {
      setState("error");
      setErrorMsg(t("voice.unavailable"));
      setTimeout(() => setState("idle"), 3000);
      return;
    }
    try {
      const rec = new Ctor();
      rec.lang = "bn-BD";
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.onresult = (event: SpeechRecognitionEvent) => {
        const transcript = event.results[0]?.[0]?.transcript ?? "";
        if (transcript.trim()) void parseText(transcript.trim());
        else { setState("error"); setErrorMsg(t("voice.error_parse")); setTimeout(() => setState("idle"), 3000); }
      };
      rec.onerror = () => { setState("error"); setErrorMsg(t("voice.error_mic")); setTimeout(() => setState("idle"), 3000); };
      recognition.current = rec;
      rec.start();
      setState("recording");
    } catch {
      setState("error");
      setErrorMsg(t("voice.error_mic"));
      setTimeout(() => setState("idle"), 3000);
    }
  };

  const handlePressOut = () => {
    // Stop listening on release; onresult (or onerror) then drives the rest.
    if (state === "recording") recognition.current?.stop();
  };

  const isRecording = state === "recording";
  const isProcessing = state === "processing";
  const bgColor = isRecording
    ? tokens.color.statusBad
    : isProcessing
      ? tokens.color.brandPrimary
      : tokens.color.actionPrimary;

  return (
    <View style={[{ alignItems: "center", gap: 6 }, style]}>
      <Animated.View style={{ transform: [{ scale: pulse }] }}>
        <Pressable
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          disabled={isProcessing}
          accessibilityRole="button"
          accessibilityLabel={t("voice.hold_to_talk")}
          accessibilityState={{ busy: isProcessing }}
          style={({ pressed }) => ({
            width: 64, height: 64, borderRadius: 32,
            backgroundColor: bgColor,
            alignItems: "center", justifyContent: "center",
            opacity: pressed ? 0.8 : 1, elevation: 6,
          })}
        >
          <Text style={{ fontSize: 24 }}>{isProcessing ? "..." : "Mic"}</Text>
        </Pressable>
      </Animated.View>

      <Text
        style={{
          fontSize: tokens.font.size.caption,
          color: state === "error" ? tokens.color.statusBad : tokens.color.textMuted,
          textAlign: "center",
        }}
      >
        {state === "error" ? errorMsg
          : isRecording ? t("voice.listening")
          : isProcessing ? "..."
          : t("voice.hold_to_talk")}
      </Text>
    </View>
  );
}

// --- Confirm modal: the draft is always shown before it fills the form ---------

interface VoiceConfirmModalProps {
  draft: VoiceDraft | null;
  onConfirm: (draft: VoiceDraft) => void;
  onCancel: () => void;
}

export function VoiceConfirmModal({ draft, onConfirm, onCancel }: VoiceConfirmModalProps) {
  const { t } = useTranslation();
  if (!draft) return null;

  return (
    <Modal visible={!!draft} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" }}>
        <View
          style={{
            backgroundColor: tokens.color.surface,
            borderTopLeftRadius: tokens.radius.lg,
            borderTopRightRadius: tokens.radius.lg,
            padding: tokens.space[6],
            gap: tokens.space[4],
          }}
        >
          <Text style={{ fontSize: tokens.font.size.title, fontWeight: "700", color: tokens.color.text }}>
            {t("voice.confirm")}
          </Text>

          <View style={{ gap: tokens.space[2] }}>
            <Text style={{ fontSize: tokens.font.size.body, color: tokens.color.textMuted }}>
              {t("voice.draft_amount", { amount: formatMoney(draft.amount_minor) })}
            </Text>
            {draft.note ? (
              <Text style={{ fontSize: tokens.font.size.body, color: tokens.color.textMuted }}>
                {t("voice.draft_note", { note: draft.note })}
              </Text>
            ) : null}
          </View>

          <View style={{ flexDirection: "row", gap: tokens.space[3] }}>
            <Pressable
              onPress={onCancel}
              style={{ flex: 1, paddingVertical: 14, borderRadius: tokens.radius.md, borderWidth: 1, borderColor: tokens.color.divider, alignItems: "center" }}
            >
              <Text style={{ color: tokens.color.text, fontWeight: "600" }}>{t("voice.cancel")}</Text>
            </Pressable>
            <Pressable
              onPress={() => onConfirm(draft)}
              style={{ flex: 2, paddingVertical: 14, borderRadius: tokens.radius.md, backgroundColor: tokens.color.actionPrimary, alignItems: "center" }}
            >
              <Text style={{ color: tokens.color.actionPrimaryText, fontWeight: "700" }}>{t("voice.confirm")}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
