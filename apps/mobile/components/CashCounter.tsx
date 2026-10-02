import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { AmountKeypad, keypadAmountMinor, tokens } from "@bizflow/ui";
import { AppIcon } from "./AppIcon";
import { Segmented, type, useBangla, useDigits } from "./kit";
import { AnimatedMoney } from "./motion";
import { feedback } from "../lib/feedback";

const c = tokens.color;
const NOTES = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1];

/**
 * Counting the drawer (docs/03 M8): either type the total, or count each note and let the
 * app add it up, the way a shopkeeper actually counts at night. Reports integer poisha.
 */
export function CashCounter({ onChange }: { onChange: (minor: number | null) => void }) {
  const { t } = useTranslation();
  const bangla = useBangla();
  const digits = useDigits();
  const [mode, setMode] = useState<"notes" | "total">("notes");
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [typed, setTyped] = useState("");
  const notesTotal = NOTES.reduce((s, n) => s + n * 100 * (counts[n] ?? 0), 0);
  const touched = Object.values(counts).some((v) => v > 0);

  function bump(note: number, delta: number) {
    feedback("tap");
    setCounts((prev) => {
      const next = { ...prev, [note]: Math.max(0, (prev[note] ?? 0) + delta) };
      const sum = NOTES.reduce((s, n) => s + n * 100 * (next[n] ?? 0), 0);
      onChange(Object.values(next).some((v) => v > 0) ? sum : null);
      return next;
    });
  }

  return (
    <View style={{ gap: tokens.space[3] }}>
      <Segmented value={mode} onChange={(m) => { setMode(m); onChange(m === "notes" ? (touched ? notesTotal : null) : typed ? keypadAmountMinor(typed) : null); }}
        items={[{ key: "notes", label: t("ux.count_notes"), icon: "coins" }, { key: "total", label: t("ux.type_total"), icon: "taka" }]} />
      {mode === "notes" ? (
        <View style={s.grid}>
          {NOTES.map((note) => (
            <View key={note} style={s.note}>
              <Text style={s.noteLabel}>৳{digits(note)}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={`- ${note}`} onPress={() => bump(note, -1)} style={s.step}><AppIcon name="minus" size={18} color={c.brandPrimary} /></Pressable>
              <Text style={s.count}>{digits(counts[note] ?? 0)}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={`+ ${note}`} onPress={() => bump(note, 1)} style={s.step}><AppIcon name="plus" size={18} color={c.brandPrimary} /></Pressable>
            </View>
          ))}
        </View>
      ) : (
        <AmountKeypad value={typed} onChange={(v) => { setTyped(v); onChange(v ? keypadAmountMinor(v) : null); }} bangla={bangla} compact />
      )}
      <View style={s.total}>
        <Text style={type.label}>{t("ux.counted_total")}</Text>
        <AnimatedMoney amountMinor={mode === "notes" ? notesTotal : keypadAmountMinor(typed)} size="title" />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: tokens.space[2] },
  note: { width: "48.5%", flexDirection: "row", alignItems: "center", gap: 4, padding: 6, paddingLeft: tokens.space[3], borderRadius: tokens.radius.md, backgroundColor: c.surface },
  noteLabel: { flex: 1, fontSize: 15, fontWeight: "700", color: c.text },
  step: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: c.brandSoft },
  count: { minWidth: 26, textAlign: "center", fontSize: 16, fontWeight: "700", color: c.text },
  total: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: tokens.space[3], borderRadius: tokens.radius.md, backgroundColor: c.brandWash },
});
