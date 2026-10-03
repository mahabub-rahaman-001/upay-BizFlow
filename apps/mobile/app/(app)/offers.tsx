import { useState } from "react";
import { RefreshControl, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { MoneyText, PrimaryButton, StatusPill, tokens } from "@bizflow/ui";
import { formatMoney } from "@bizflow/shared";
import { AppIcon, type AppIconName } from "../../components/AppIcon";
import { AmountRow, Card, ChoiceCard, Divider, EmptyState, Field, IconTile, Notice, ProgressBar, Screen, ScreenHeader, Segmented, Sheet, SkeletonRows, StepHeader, TextLink, showToast, type, useBangla, useDigits } from "../../components/kit";
import { PostingError, useCreateOffer, useEndOffer, useOfferResults, useOffers, usePauseOffer, usePublishOffer, useResumeOffer, type OfferRow, type OfferType } from "../../lib/api";
import { useActiveBusiness } from "../../lib/session";
import { feedback } from "../../lib/feedback";
import { useFormatters } from "../../lib/view";

const c = tokens.color;
const TYPE_ICON: Record<OfferType, AppIconName> = { PERCENT_OFF: "percent", AMOUNT_OFF: "taka", BXGY: "gift", STAMP: "stamp" };
const TYPE_KEY: Record<OfferType, string> = { PERCENT_OFF: "percent", AMOUNT_OFF: "amount", BXGY: "bxgy", STAMP: "stamp" };

/** Offers (docs/03 M11): what is running, what it cost, and a 3-step way to start one. */
export default function Offers() {
  const { t } = useTranslation();
  const { data, isLoading, refetch, isRefetching } = useOffers();
  const [tab, setTab] = useState<"live" | "draft" | "ended">("live");
  const [creating, setCreating] = useState(false);
  const list = (data ?? []).filter((o) => (tab === "live" ? o.status === "ACTIVE" || o.status === "PAUSED" : tab === "draft" ? o.status === "DRAFT" : o.status === "ENDED"));

  if (creating) return <Wizard onClose={() => { setCreating(false); void refetch(); }} />;
  return (
    <Screen inTabs header={<ScreenHeader title={t("offers.title")} subtitle={t("ux.offer_preview")} />} refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={c.brandPrimary} />}
      footer={<PrimaryButton label={t("offers.new")} icon={<AppIcon name="plus" size={20} color={c.actionPrimaryText} />} onPress={() => setCreating(true)} />}>
      <Segmented value={tab} onChange={setTab} items={[{ key: "live", label: t("ux.offers_active") }, { key: "draft", label: t("ux.offers_draft") }, { key: "ended", label: t("ux.offers_ended") }]} />
      {isLoading ? <SkeletonRows /> : list.length === 0 ? <EmptyState icon="offers" title={t("empty.offers")} body={t("empty.offers_sub")} /> : (
        <View style={{ gap: tokens.space[3] }}>{list.map((o) => <OfferCard key={o.id} offer={o} />)}</View>
      )}
    </Screen>
  );
}

function OfferCard({ offer }: { offer: OfferRow }) {
  const { t } = useTranslation();
  const bangla = useBangla();
  const digits = useDigits();
  const fmt = useFormatters();
  const publish = usePublishOffer();
  const pause = usePauseOffer();
  const resume = useResumeOffer();
  const end = useEndOffer();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const pct = offer.budget_minor > 0 ? offer.spent_minor / offer.budget_minor : 0;
  const auto = offer.status === "PAUSED" && offer.spent_minor >= offer.budget_minor;
  const status = { DRAFT: ["neutral", "offers.status_draft"], ACTIVE: ["good", "offers.status_active"], PAUSED: ["warn", "offers.status_paused"], ENDED: ["neutral", "offers.status_ended"] } as const;
  const [kind, word] = status[offer.status];

  async function act(fn: () => Promise<unknown>) {
    try { await fn(); feedback("success"); } catch (e) { feedback("error"); showToast({ kind: "bad", title: t(`posting_error.${e instanceof PostingError ? e.code : "UNKNOWN"}`) }); }
  }

  return (
    <Card style={{ gap: tokens.space[2] }}>
      <View style={s.row}>
        <IconTile name={TYPE_ICON[offer.type]} tone="amber" size={44} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={2} style={type.label}>{offer.title}</Text>
          <Text style={type.caption}>{fmt.day.format(new Date(offer.starts_at))} - {fmt.day.format(new Date(offer.ends_at))}</Text>
        </View>
        <StatusPill kind={kind} compact label={t(word)} />
      </View>
      {auto ? <Notice kind="warn" title={t("offers.auto_paused")} /> : null}
      <View style={{ gap: 4 }}>
        <View style={s.between}>
          <Text style={type.caption}>{t("offers.budget_bar_label", { spent: formatMoney(offer.spent_minor, { bangla, currency: "taka-sign" }), budget: formatMoney(offer.budget_minor, { bangla, currency: "taka-sign" }) })}</Text>
          <Text style={type.caption}>{digits(Math.round(pct * 100))}%</Text>
        </View>
        <ProgressBar value={pct} tone={pct >= 1 ? "bad" : pct > 0.75 ? "warn" : "brand"} />
        <Text style={type.caption}>{t("offers.redemptions", { count: offer.redemption_count })}</Text>
      </View>
      {offer.status === "ENDED" ? <Results offerId={offer.id} /> : null}
      <View style={s.actions}>
        {offer.status === "DRAFT" ? <TextLink label={t("offers.publish")} onPress={() => void act(() => publish.mutateAsync({ offer_id: offer.id }))} /> : null}
        {offer.status === "ACTIVE" ? <TextLink label={t("offers.pause")} onPress={() => void act(() => pause.mutateAsync({ offer_id: offer.id }))} /> : null}
        {offer.status === "PAUSED" && !auto ? <TextLink label={t("offers.resume")} onPress={() => void act(() => resume.mutateAsync({ offer_id: offer.id }))} /> : null}
        {offer.status !== "ENDED" ? <TextLink label={t("offers.end")} tone="bad" onPress={() => setConfirmEnd(true)} /> : null}
      </View>
      <Sheet visible={confirmEnd} onClose={() => setConfirmEnd(false)} title={t("offers.end")} footer={<PrimaryButton variant="danger" label={t("offers.end")} busy={end.isPending} onPress={() => void act(() => end.mutateAsync({ offer_id: offer.id })).then(() => setConfirmEnd(false))} />}>
        <Notice kind="warn" title={offer.title} body={t("offers.confirm_end")} />
      </Sheet>
    </Card>
  );
}

function Results({ offerId }: { offerId: string }) {
  const { t } = useTranslation();
  const { data } = useOfferResults(offerId);
  if (!data) return null;
  return (
    <Card tone="ai" style={{ gap: 2 }}>
      <Text style={[type.label, { color: c.aiBorder }]}>{t("offers.results_title")}</Text>
      <AmountRow label={t("offers.results_pre")} amount={data.pre_sales_minor} />
      <AmountRow label={t("offers.results_post")} amount={data.post_sales_minor} />
      <AmountRow label={t("offers.results_cost")} amount={data.total_discount_minor} sign="out" />
      <Divider />
      <AmountRow label={t("offers.results_lift")} amount={data.net_lift_minor} strong />
    </Card>
  );
}

function Wizard({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const bangla = useBangla();
  const business = useActiveBusiness();
  const create = useCreateOffer();
  const publish = usePublishOffer();
  const today = new Date().toISOString().slice(0, 10);
  const in14 = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const [step, setStep] = useState(1);
  const [kind, setKind] = useState<OfferType>("PERCENT_OFF");
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("10");
  const [budget, setBudget] = useState("1000");
  const [start, setStart] = useState(today);
  const [endDate, setEndDate] = useState(in14);
  const [audience, setAudience] = useState<"all" | "returning" | "new">("all");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const n = Number(value.replace(/[^\d]/g, "")) || 0;
  const params = kind === "PERCENT_OFF" ? { pct: n } : kind === "AMOUNT_OFF" ? { off_minor: n * 100 } : kind === "BXGY" ? { buy_qty: n || 2, get_qty: 1 } : { goal: n || 5, reward_minor: 2000 };
  const valueLabel = kind === "PERCENT_OFF" ? t("offers.field_pct") : kind === "AMOUNT_OFF" ? t("offers.field_off") : kind === "BXGY" ? t("offers.field_buy") : t("offers.field_goal");
  const budgetMinor = (Number(budget.replace(/[^\d]/g, "")) || 0) * 100;
  const valid = title.trim().length > 0 && n > 0 && budgetMinor > 0 && /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(endDate) && endDate > start;

  async function save(live: boolean) {
    setBusy(true);
    setError(null);
    try {
      const result = await create.mutateAsync({ type: kind, title: title.trim(), params, budget_minor: budgetMinor, starts_at: new Date(`${start}T00:00:00+06:00`).toISOString(), ends_at: new Date(`${endDate}T23:59:00+06:00`).toISOString(), audience });
      if (live) await publish.mutateAsync({ offer_id: result.offer_id });
      feedback("success");
      showToast({ kind: "good", title: t(live ? "ux.offer_published" : "ux.offer_draft_saved") });
      onClose();
    } catch (e) {
      feedback("error");
      setError(t(`posting_error.${e instanceof PostingError ? e.code : "UNKNOWN"}`));
    } finally {
      setBusy(false);
    }
  }

  const footer = step < 3
    ? <PrimaryButton label={t("ux.next")} disabled={step === 2 && !valid} onPress={() => setStep(step + 1)} />
    : <>
        <PrimaryButton label={t("offers.publish")} busy={busy} disabled={!valid} onPress={() => void save(true)} />
        <PrimaryButton variant="ghost" label={t("offers.save_draft")} disabled={busy || !valid} onPress={() => void save(false)} />
      </>;

  return (
    <Screen header={<ScreenHeader title={t("offers.new")} onBack={() => (step > 1 ? setStep(step - 1) : onClose())} />} footer={footer}>
      <StepHeader step={step} total={3} label={t(step === 1 ? "offers.wizard_step1" : step === 2 ? "offers.wizard_step2" : "offers.wizard_step3")} />
      {step === 1 ? (
        <View style={{ gap: tokens.space[2] }}>
          {(Object.keys(TYPE_ICON) as OfferType[]).map((k) => (
            <ChoiceCard key={k} icon={TYPE_ICON[k]} tone="amber" label={t(`offers.type_${TYPE_KEY[k]}`)} hint={t(`offers.type_${TYPE_KEY[k]}_desc`)} selected={kind === k} onPress={() => { setKind(k); setValue(k === "PERCENT_OFF" ? "10" : k === "AMOUNT_OFF" ? "30" : k === "BXGY" ? "2" : "5"); }} />
          ))}
        </View>
      ) : null}
      {step === 2 ? (
        <View style={{ gap: tokens.space[3] }}>
          <Field label={t("offers.field_title")} value={title} onChangeText={setTitle} maxLength={60} />
          <Field label={valueLabel} value={value} onChangeText={setValue} keyboardType="number-pad" />
          <Field label={t("offers.field_budget")} value={budget} onChangeText={setBudget} keyboardType="number-pad" prefix="৳" />
          <View style={{ flexDirection: "row", gap: tokens.space[2] }}>
            <View style={{ flex: 1 }}><Field label={t("offers.field_start")} value={start} onChangeText={setStart} /></View>
            <View style={{ flex: 1 }}><Field label={t("offers.field_end")} value={endDate} onChangeText={setEndDate} error={endDate <= start ? t("posting_error.OFFER_DATE_INVALID") : null} /></View>
          </View>
        </View>
      ) : null}
      {step === 3 ? (
        <View style={{ gap: tokens.space[3] }}>
          <Text style={type.label}>{t("offers.field_audience")}</Text>
          {(["all", "returning", "new"] as const).map((a) => (
            <ChoiceCard key={a} icon={a === "all" ? "users" : a === "returning" ? "refresh" : "user"} label={t(`offers.audience_${a}`)} selected={audience === a} onPress={() => setAudience(a)} />
          ))}
          <Text style={type.label}>{t("ux.offer_preview")}</Text>
          <View style={s.receipt}>
            <View style={s.row}><AppIcon name="verified" size={18} color={c.verified} /><Text style={type.label}>{business?.name}</Text></View>
            <Text style={type.caption}>{t("ux.payment_received")}</Text>
            <MoneyText amountMinor={85000} bangla={bangla} size="title" />
            <Divider />
            <View style={s.row}><AppIcon name={TYPE_ICON[kind]} size={18} color={c.statusWarn} /><Text style={[type.label, { flex: 1 }]}>{title || t(`offers.type_${TYPE_KEY[kind]}`)}</Text></View>
          </View>
          {error ? <Notice kind="bad" title={error} /> : null}
        </View>
      ) : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: tokens.space[2] },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  actions: { flexDirection: "row", gap: tokens.space[4], justifyContent: "flex-end" },
  receipt: { padding: tokens.space[4], gap: 6, borderRadius: tokens.radius.lg, backgroundColor: c.surface, borderWidth: 1, borderStyle: "dashed", borderColor: c.divider },
});
