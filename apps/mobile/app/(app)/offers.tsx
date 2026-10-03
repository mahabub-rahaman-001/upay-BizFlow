import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import {
  PostingError,
  useCreateOffer,
  useEndOffer,
  useOfferResults,
  useOffers,
  usePauseOffer,
  usePublishOffer,
  useResumeOffer,
  type OfferRow,
  type OfferStatus,
  type OfferType,
} from "../../lib/api";
import { EmptyState } from "../../components/EmptyState";

// ─── tiny design tokens (mirrors packages/ui tokens) ─────────────────────────
const C = {
  bg: "#F7F8FA",
  surface: "#FFFFFF",
  text: "#111827",
  muted: "#5B6472",
  brand: "#0B4EA2",
  action: "#F59E0B",
  good: "#15803D",
  goodBg: "#DCFCE7",
  warn: "#B45309",
  warnBg: "#FEF3C7",
  bad: "#B91C1C",
  badBg: "#FEE2E2",
  divider: "#E5E7EB",
};
const R = { sm: 8, md: 12, lg: 20 };
const S = [0, 4, 8, 12, 16, 24, 32, 48];

function tk(minor: number) {
  return `Tk ${(minor / 100).toFixed(0)}`;
}

// ─── STATUS BADGE ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: OfferStatus }) {
  const { t } = useTranslation();
  const map: Record<OfferStatus, [string, string]> = {
    DRAFT:  [C.muted,  "#F3F4F6"],
    ACTIVE: [C.good,   C.goodBg],
    PAUSED: [C.warn,   C.warnBg],
    ENDED:  [C.bad,    C.badBg],
  };
  const [color, bg] = map[status];
  const label: Record<OfferStatus, string> = {
    DRAFT:  t("offers.status_draft"),
    ACTIVE: t("offers.status_active"),
    PAUSED: t("offers.status_paused"),
    ENDED:  t("offers.status_ended"),
  };
  return (
    <View style={{ backgroundColor: bg, borderRadius: R.sm, paddingHorizontal: S[2], paddingVertical: 2 }}>
      <Text style={{ fontSize: 12, fontWeight: "600", color }}>{label[status]}</Text>
    </View>
  );
}

// ─── BUDGET BAR ───────────────────────────────────────────────────────────────
function BudgetBar({ spent, budget }: { spent: number; budget: number }) {
  const pct = Math.min(1, budget > 0 ? spent / budget : 0);
  const barColor = pct >= 1 ? C.bad : pct > 0.75 ? C.warn : C.brand;
  return (
    <View style={{ height: 6, backgroundColor: C.divider, borderRadius: 999, marginTop: S[1] }}>
      <View style={{ height: 6, width: `${pct * 100}%`, backgroundColor: barColor, borderRadius: 999 }} />
    </View>
  );
}

// ─── RESULTS CARD (DiD) ───────────────────────────────────────────────────────
function ResultsCard({ offerId }: { offerId: string }) {
  const { t } = useTranslation();
  const { data: res, isLoading } = useOfferResults(offerId);
  if (isLoading) return <ActivityIndicator size="small" color={C.brand} style={{ marginTop: S[2] }} />;
  if (!res) return null;

  const lift = res.net_lift_minor;
  const liftColor = lift >= 0 ? C.good : C.bad;

  return (
    <View style={{ marginTop: S[3], backgroundColor: "#EEF2FF", borderRadius: R.md, padding: S[3], borderWidth: 1, borderColor: "#6366F1" }}>
      <Text style={{ fontSize: 13, fontWeight: "700", color: "#6366F1", marginBottom: S[2] }}>{t("offers.results_title")}</Text>
      {[
        [t("offers.results_pre"),   tk(res.pre_sales_minor),         C.text],
        [t("offers.results_post"),  tk(res.post_sales_minor),        C.text],
        [t("offers.results_lift"),  (lift >= 0 ? "+" : "") + tk(lift), liftColor],
        [t("offers.results_cost"),  tk(res.total_discount_minor),    C.warn],
        [t("offers.results_count"), String(res.redemption_count),    C.text],
      ].map(([label, value, color]) => (
        <View key={label} style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 2 }}>
          <Text style={{ fontSize: 13, color: C.muted }}>{label}</Text>
          <Text style={{ fontSize: 13, fontWeight: "600", color }}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

// ─── OFFER CARD ───────────────────────────────────────────────────────────────
function OfferCard({ offer, onAction }: { offer: OfferRow; onAction: () => void }) {
  const { t } = useTranslation();
  const pause   = usePauseOffer();
  const resume  = useResumeOffer();
  const endOff  = useEndOffer();
  const [err, setErr] = useState<string | null>(null);

  async function act(fn: () => Promise<unknown>, msg: string) {
    setErr(null);
    try { await fn(); onAction(); }
    catch (e) { setErr(t(`posting_error.${e instanceof PostingError ? e.code : "UNKNOWN"}`)); }
  }

  const isAutoPaused = offer.status === "PAUSED" && offer.spent_minor >= offer.budget_minor;

  return (
    <View style={{ backgroundColor: C.surface, borderRadius: R.lg, padding: S[4], marginBottom: S[3], shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 }}>
      {/* Header row */}
      <View style={{ flexDirection: "row", alignItems: "flex-start", marginBottom: S[2] }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: "700", color: C.text }}>{offer.title}</Text>
          <Text style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>{t("offers.redemptions", { count: offer.redemption_count })}</Text>
        </View>
        <StatusBadge status={offer.status} />
      </View>

      {/* Auto-paused warning */}
      {isAutoPaused && (
        <View style={{ backgroundColor: C.badBg, borderRadius: R.sm, padding: S[2], marginBottom: S[2] }}>
          <Text style={{ fontSize: 12, color: C.bad }}>{t("offers.auto_paused")}</Text>
        </View>
      )}

      {/* Budget */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 2 }}>
        <Text style={{ fontSize: 12, color: C.muted }}>{t("offers.budget_bar_label", { spent: tk(offer.spent_minor), budget: tk(offer.budget_minor) })}</Text>
        <Text style={{ fontSize: 12, color: C.muted }}>{Math.round((offer.spent_minor / offer.budget_minor) * 100)}%</Text>
      </View>
      <BudgetBar spent={offer.spent_minor} budget={offer.budget_minor} />

      {/* Dates */}
      <Text style={{ fontSize: 11, color: C.muted, marginTop: S[2] }}>
        {new Date(offer.starts_at).toLocaleDateString()} – {new Date(offer.ends_at).toLocaleDateString()}
      </Text>

      {/* Actions */}
      {offer.status !== "ENDED" && offer.status !== "DRAFT" && (
        <View style={{ flexDirection: "row", gap: S[2], marginTop: S[3] }}>
          {offer.status === "ACTIVE" && !isAutoPaused && (
            <Pressable
              onPress={() => act(() => pause.mutateAsync({ offer_id: offer.id }), "pause")}
              style={{ flex: 1, paddingVertical: S[2], borderRadius: R.md, backgroundColor: C.warnBg, alignItems: "center" }}
            >
              <Text style={{ fontSize: 14, fontWeight: "600", color: C.warn }}>{t("offers.pause")}</Text>
            </Pressable>
          )}
          {offer.status === "PAUSED" && !isAutoPaused && (
            <Pressable
              onPress={() => act(() => resume.mutateAsync({ offer_id: offer.id }), "resume")}
              style={{ flex: 1, paddingVertical: S[2], borderRadius: R.md, backgroundColor: C.goodBg, alignItems: "center" }}
            >
              <Text style={{ fontSize: 14, fontWeight: "600", color: C.good }}>{t("offers.resume")}</Text>
            </Pressable>
          )}
          <Pressable
            onPress={() =>
              Alert.alert(t("offers.end"), t("offers.confirm_end"), [
                { text: t("common.close"), style: "cancel" },
                { text: t("offers.end"), style: "destructive",
                  onPress: () => act(() => endOff.mutateAsync({ offer_id: offer.id }), "end") },
              ])
            }
            style={{ flex: 1, paddingVertical: S[2], borderRadius: R.md, backgroundColor: C.badBg, alignItems: "center" }}
          >
            <Text style={{ fontSize: 14, fontWeight: "600", color: C.bad }}>{t("offers.end")}</Text>
          </Pressable>
        </View>
      )}

      {/* Error */}
      {err && <Text style={{ fontSize: 12, color: C.bad, marginTop: S[2] }}>{err}</Text>}

      {/* DiD results for ended offers */}
      {offer.status === "ENDED" && <ResultsCard offerId={offer.id} />}
    </View>
  );
}

// ─── CREATE WIZARD ────────────────────────────────────────────────────────────
type WizardStep = 1 | 2 | 3;

const OFFER_TYPES: { key: OfferType; icon: string }[] = [
  { key: "PERCENT_OFF", icon: "%" },
  { key: "AMOUNT_OFF",  icon: "৳" },
  { key: "BXGY",        icon: "🎁" },
  { key: "STAMP",       icon: "🏷️" },
];

interface WizardState {
  type: OfferType;
  title: string;
  pct: string;
  off: string;
  buyQty: string;
  getQty: string;
  goal: string;
  reward: string;
  budget: string;
  startsAt: string;
  endsAt: string;
  audience: "all" | "returning" | "new";
}

function defaultWizard(): WizardState {
  const today = new Date().toISOString().split("T")[0];
  const next7 = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];
  return {
    type: "PERCENT_OFF", title: "", pct: "10", off: "", buyQty: "2", getQty: "1",
    goal: "5", reward: "500", budget: "", startsAt: today, endsAt: next7, audience: "all",
  };
}

function wizardParams(w: WizardState): Record<string, unknown> {
  switch (w.type) {
    case "PERCENT_OFF": return { pct: Number(w.pct) };
    case "AMOUNT_OFF":  return { off_minor: Number(w.off) * 100 };
    case "BXGY":        return { buy_qty: Number(w.buyQty), get_qty: Number(w.getQty) };
    case "STAMP":       return { goal: Number(w.goal), reward_minor: Number(w.reward) * 100 };
  }
}

function CreateWizard({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const createOffer  = useCreateOffer();
  const publishOffer = usePublishOffer();
  const [step, setStep] = useState<WizardStep>(1);
  const [w, setW] = useState<WizardState>(defaultWizard);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function field(key: keyof WizardState, label: string, placeholder = "") {
    return (
      <View style={{ marginBottom: S[3] }}>
        <Text style={{ fontSize: 13, color: C.muted, marginBottom: S[1] }}>{label}</Text>
        <TextInput
          value={String(w[key])}
          onChangeText={(v) => setW((prev) => ({ ...prev, [key]: v }))}
          placeholder={placeholder}
          placeholderTextColor={C.divider}
          keyboardType={["pct","off","buyQty","getQty","goal","reward","budget"].includes(key) ? "numeric" : "default"}
          style={{ backgroundColor: C.bg, borderRadius: R.md, paddingHorizontal: S[3], paddingVertical: S[2], fontSize: 16, color: C.text, borderWidth: 1, borderColor: C.divider }}
        />
      </View>
    );
  }

  async function save(publish: boolean) {
    setSaving(true); setErr(null);
    try {
      const result = await createOffer.mutateAsync({
        type: w.type,
        title: w.title.trim(),
        params: wizardParams(w),
        budget_minor: Number(w.budget) * 100,
        starts_at: new Date(w.startsAt).toISOString(),
        ends_at: new Date(w.endsAt).toISOString(),
        audience: w.audience,
      });
      if (publish) {
        await publishOffer.mutateAsync({ offer_id: result.offer_id });
      }
      onDone();
    } catch (e) {
      setErr(t(`posting_error.${e instanceof PostingError ? e.code : "UNKNOWN"}`));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.surface }}>
      {/* Step indicator */}
      <View style={{ flexDirection: "row", paddingHorizontal: S[4], paddingVertical: S[3], gap: S[2] }}>
        {([1,2,3] as WizardStep[]).map((s) => (
          <View key={s} style={{ flex: 1, height: 4, borderRadius: 999, backgroundColor: step >= s ? C.brand : C.divider }} />
        ))}
      </View>

      <ScrollView contentContainerStyle={{ padding: S[4] }}>
        <Text style={{ fontSize: 20, fontWeight: "700", color: C.text, marginBottom: S[4] }}>
          {step === 1 ? t("offers.wizard_step1") : step === 2 ? t("offers.wizard_step2") : t("offers.wizard_step3")}
        </Text>

        {/* Step 1: type */}
        {step === 1 && OFFER_TYPES.map(({ key, icon }) => (
          <Pressable key={key} onPress={() => setW((p) => ({ ...p, type: key }))}
            style={{ flexDirection: "row", alignItems: "center", backgroundColor: w.type === key ? "#EEF2FF" : C.bg, borderRadius: R.md, padding: S[3], marginBottom: S[2], borderWidth: 1, borderColor: w.type === key ? "#6366F1" : C.divider }}>
            <Text style={{ fontSize: 24, marginRight: S[3] }}>{icon}</Text>
            <View>
              <Text style={{ fontSize: 15, fontWeight: "600", color: C.text }}>{t(`offers.type_${key.toLowerCase().replace("_off","").replace("bxgy","bxgy")}`)}</Text>
              <Text style={{ fontSize: 13, color: C.muted }}>{t(`offers.type_${key.toLowerCase().replace("_off","").replace("bxgy","bxgy")}_desc`)}</Text>
            </View>
          </Pressable>
        ))}

        {/* Step 2: params + budget + dates */}
        {step === 2 && (
          <>
            {field("title", t("offers.field_title"), "Eid Sale 10%")}
            {w.type === "PERCENT_OFF" && field("pct", t("offers.field_pct"), "10")}
            {w.type === "AMOUNT_OFF"  && field("off", t("offers.field_off"), "50")}
            {w.type === "BXGY" && <>
              {field("buyQty", t("offers.field_buy"), "2")}
              {field("getQty", t("offers.field_get"), "1")}
            </>}
            {w.type === "STAMP" && <>
              {field("goal", t("offers.field_goal"), "5")}
              {field("reward", t("offers.field_reward"), "100")}
            </>}
            {field("budget", t("offers.field_budget"), "1000")}
            {field("startsAt", t("offers.field_start"))}
            {field("endsAt",   t("offers.field_end"))}
          </>
        )}

        {/* Step 3: review */}
        {step === 3 && (
          <View style={{ backgroundColor: C.bg, borderRadius: R.md, padding: S[3] }}>
            {[
              [t("offers.field_title"),  w.title],
              [t("offers.wizard_step1"), t(`offers.type_${w.type.toLowerCase().replace("_off","").replace("bxgy","bxgy")}`)],
              [t("offers.budget"),       `Tk ${w.budget}`],
              [t("offers.field_start"),  w.startsAt],
              [t("offers.field_end"),    w.endsAt],
              [t("offers.field_audience"), t(`offers.audience_${w.audience}`)],
            ].map(([label, value]) => (
              <View key={label} style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: S[2] }}>
                <Text style={{ fontSize: 13, color: C.muted }}>{label}</Text>
                <Text style={{ fontSize: 13, fontWeight: "600", color: C.text }}>{value}</Text>
              </View>
            ))}
          </View>
        )}

        {err && <Text style={{ fontSize: 13, color: C.bad, marginTop: S[2] }}>{err}</Text>}
      </ScrollView>

      {/* Footer buttons */}
      <View style={{ padding: S[4], gap: S[2] }}>
        {step < 3 ? (
          <Pressable onPress={() => setStep((s) => (s + 1) as WizardStep)}
            style={{ backgroundColor: C.brand, borderRadius: R.md, paddingVertical: S[3], alignItems: "center" }}>
            <Text style={{ fontSize: 16, fontWeight: "700", color: "#FFF" }}>→</Text>
          </Pressable>
        ) : (
          <>
            <Pressable onPress={() => save(true)} disabled={saving}
              style={{ backgroundColor: saving ? C.divider : C.action, borderRadius: R.md, paddingVertical: S[3], alignItems: "center" }}>
              <Text style={{ fontSize: 16, fontWeight: "700", color: "#1A1300" }}>{saving ? "..." : t("offers.publish")}</Text>
            </Pressable>
            <Pressable onPress={() => save(false)} disabled={saving}
              style={{ backgroundColor: C.bg, borderRadius: R.md, paddingVertical: S[3], alignItems: "center", borderWidth: 1, borderColor: C.divider }}>
              <Text style={{ fontSize: 16, fontWeight: "600", color: C.muted }}>{t("offers.save_draft")}</Text>
            </Pressable>
          </>
        )}
        {step > 1 && (
          <Pressable onPress={() => setStep((s) => (s - 1) as WizardStep)}
            style={{ alignItems: "center", paddingVertical: S[2] }}>
            <Text style={{ fontSize: 14, color: C.muted }}>← {t("common.close")}</Text>
          </Pressable>
        )}
        {step === 1 && (
          <Pressable onPress={onCancel} style={{ alignItems: "center", paddingVertical: S[2] }}>
            <Text style={{ fontSize: 14, color: C.muted }}>{t("common.close")}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

// ─── MAIN SCREEN ──────────────────────────────────────────────────────────────
/** Offer creation in three progressive steps (docs/04 section 13.8). P8. */
export default function Offers() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { data: offers, isLoading, refetch } = useOffers();
  const [showCreate, setShowCreate] = useState(false);

  if (showCreate) {
    return (
      <View style={{ flex: 1, paddingTop: insets.top }}>
        <CreateWizard onDone={() => { setShowCreate(false); void refetch(); }} onCancel={() => setShowCreate(false)} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + S[3] }}>
      {/* Header */}
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: S[4], marginBottom: S[3] }}>
        <Text style={{ flex: 1, fontSize: 20, fontWeight: "700", color: C.text }}>{t("offers.title")}</Text>
        <Pressable
          id="offers-new-btn"
          onPress={() => setShowCreate(true)}
          style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: C.action, alignItems: "center", justifyContent: "center" }}
        >
          <Text style={{ fontSize: 24, color: "#1A1300", lineHeight: 28 }}>+</Text>
        </Pressable>
      </View>

      {/* List */}
      {isLoading ? (
        <ActivityIndicator size="large" color={C.brand} style={{ marginTop: S[6] }} />
      ) : !offers || offers.length === 0 ? (
        <EmptyState
          icon="🏷️"
          title={t("empty.offers")}
          subtitle={t("empty.offers_sub")}
          actionLabel={t("offers.new")}
          onAction={() => setShowCreate(true)}
        />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: S[4], paddingBottom: insets.bottom + S[6] }}
          showsVerticalScrollIndicator={false}
        >
          {offers.map((offer) => (
            <OfferCard key={offer.id} offer={offer} onAction={() => void refetch()} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}
