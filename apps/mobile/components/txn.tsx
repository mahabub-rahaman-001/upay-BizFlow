/**
 * One transaction row and its detail sheet. Verified rows sit on white with a green check;
 * hand-written rows sit on warm paper with a pen mark, so the two never blur (docs/16 s.2).
 */
import { memo, useRef, useState } from "react";
import { Pressable, Share, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { MoneyText, PrimaryButton, StatusPill, tokens } from "@bizflow/ui";
import { AppIcon } from "./AppIcon";
import { Divider, Field, IconTile, Notice, Sheet, SourceBadge, showToast, type, useBangla } from "./kit";
import { PostingError, useReceiptLink, useReverseTransaction, type TransactionRow } from "../lib/api";
import { useActiveBusiness, useIsOwner } from "../lib/session";
import { promptReauth } from "../lib/reauth";
import { feedback } from "../lib/feedback";
import { txnDirection, txnIcon, txnSubtitle, txnTitle, txnTone, useFormatters } from "../lib/view";

const c = tokens.color;

export const TxnItem = memo(function TxnItem({ row, reversed, onPress }: { row: TransactionRow; reversed?: boolean; onPress?: (row: TransactionRow) => void }) {
  const { t } = useTranslation();
  const bangla = useBangla();
  const fmt = useFormatters();
  const manual = row.source === "manual";
  const dir = txnDirection(row);
  const subtitle = txnSubtitle(row, t);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${txnTitle(row, t)}, ${t(manual ? "ux.manual_short" : "ux.verified_short")}`}
      onPress={onPress ? () => onPress(row) : undefined}
      style={({ pressed }) => [s.row, manual && s.rowManual, pressed && { opacity: 0.85 }]}
    >
      <IconTile name={txnIcon(row.kind)} tone={txnTone(row)} size={42} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text numberOfLines={1} style={[type.label, reversed && s.struck]}>{txnTitle(row, t)}</Text>
        <View style={s.meta}>
          <SourceBadge source={row.source} />
          <Text numberOfLines={1} style={[type.caption, { flexShrink: 1 }]}>{[fmt.time.format(new Date(row.occurred_at)), subtitle].filter(Boolean).join(" · ")}</Text>
        </View>
      </View>
      <View style={{ alignItems: "flex-end", gap: 2 }}>
        <MoneyText amountMinor={Number(row.amount_minor)} bangla={bangla} signed={dir === "none" ? undefined : dir} style={reversed ? s.struck : undefined} />
        {reversed ? <Text style={[type.caption, { color: c.statusBad }]}>{t("transactions.reversed")}</Text> : null}
      </View>
    </Pressable>
  );
});

export function TxnDetailSheet({ row, reversed, onClose }: { row: TransactionRow | null; reversed: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const router = useRouter();
  const bangla = useBangla();
  const fmt = useFormatters();
  const isOwner = useIsOwner();
  const merchant = useActiveBusiness()?.type === "MERCHANT";
  const receipt = useReceiptLink();
  const reverse = useReverseTransaction();
  const [correcting, setCorrecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const clientUuid = useRef(globalThis.crypto.randomUUID());

  if (!row) return null;
  const manual = row.source === "manual";
  const dir = txnDirection(row);
  const canCorrect = manual && isOwner && !reversed && row.kind !== "REVERSAL";
  const canRefund = merchant && isOwner && !reversed && (row.kind === "QR_PAYMENT" || row.kind === "CASH_SALE");

  function close() {
    setCorrecting(false);
    setReason("");
    setError(null);
    onClose();
  }

  async function shareReceipt() {
    try {
      const url = await receipt.mutateAsync(row!.id);
      await Share.share({ message: url ?? `${txnTitle(row!, t)} · ${fmt.full.format(new Date(row!.occurred_at))}` });
    } catch {
      // Cancelled share sheet: nothing to do.
    }
  }

  async function correct() {
    setError(null);
    const auth = await promptReauth(t("reauth.title"));
    if (!auth.success) { setError(t("reauth.failed")); return; }
    try {
      await reverse.mutateAsync({ transaction_id: row!.id, reason: reason.trim(), client_uuid: clientUuid.current });
      feedback("success");
      showToast({ kind: "manual", title: t("ux.corrected") });
      clientUuid.current = globalThis.crypto.randomUUID();
      close();
    } catch (e) {
      feedback("error");
      setError(t(`posting_error.${e instanceof PostingError ? e.code : "UNKNOWN"}`));
    }
  }

  return (
    <Sheet visible onClose={close} title={t("ux.details")}>
      <View style={[s.hero, manual && s.heroManual]}>
        <IconTile name={txnIcon(row.kind)} tone={txnTone(row)} size={52} />
        <MoneyText amountMinor={Number(row.amount_minor)} bangla={bangla} size="numberLg" signed={dir === "none" ? undefined : dir} />
        <Text style={[type.label, { textAlign: "center" }]}>{txnTitle(row, t)}</Text>
        <SourceBadge source={row.source} compact={false} />
        <Text style={[type.caption, { textAlign: "center" }]}>{t(manual ? "ux.manual_explain" : "ux.digital_explain")}</Text>
      </View>

      <View style={s.card}>
        <Line label={t("ux.d_type")} value={t(`txn_kind.${row.kind}`, { defaultValue: row.kind })} />
        <Divider />
        <Line label={t("ux.d_time")} value={fmt.full.format(new Date(row.occurred_at))} />
        {row.kind === "QR_PAYMENT" && row.note ? <><Divider /><Line label={t("ux.d_from")} value={row.note} /></> : null}
        {row.kind === "MANUAL_WALLET" && row.wallet ? <><Divider /><Line label={t("ux.d_wallet")} value={row.wallet} /></> : null}
        {row.reference ? <><Divider /><Line label={t("ux.d_ref")} value={row.reference} /></> : null}
        {!manual ? (
          <>
            <Divider />
            <View style={s.line}>
              <Text style={type.caption}>{t("ux.d_payment")}</Text>
              <StatusPill kind="good" compact icon={<AppIcon name="check" size={12} color={c.statusGood} strokeWidth={2.6} />} label={t("ux.received")} />
            </View>
            <Divider />
            <View style={s.line}>
              <Text style={type.caption}>{t("ux.d_settlement")}</Text>
              {row.wallet === "pending"
                ? <StatusPill kind="warn" compact icon={<AppIcon name="clock" size={12} color={c.statusWarn} />} label={t("ux.pending")} />
                : <StatusPill kind="good" compact icon={<AppIcon name="check" size={12} color={c.statusGood} strokeWidth={2.6} />} label={t("ux.settled")} />}
            </View>
          </>
        ) : null}
        {reversed ? <><Divider /><View style={s.line}><Text style={type.caption}>{t("ux.d_type")}</Text><StatusPill kind="bad" compact label={t("transactions.reversed")} /></View></> : null}
      </View>

      {correcting ? (
        <View style={{ gap: tokens.space[3] }}>
          <Notice kind="manual" title={t("ux.correct_title")} body={t("ux.correct_body")} />
          <Field label={t("ux.correct_reason")} value={reason} onChangeText={setReason} maxLength={240} error={error} />
          <PrimaryButton label={t("ux.correct_confirm")} busy={reverse.isPending} disabled={reason.trim().length < 3} onPress={() => void correct()} />
        </View>
      ) : (
        <View style={{ gap: tokens.space[2] }}>
          {!manual && row.kind !== "AGENT_COMMISSION" ? <PrimaryButton variant="secondary" label={t("ux.share_receipt")} icon={<AppIcon name="share" size={18} color={c.brandPrimary} />} busy={receipt.isPending} onPress={() => void shareReceipt()} /> : null}
          {canRefund ? <PrimaryButton variant="ghost" label={t("ux.refund_this")} icon={<AppIcon name="refund" size={18} color={c.brandPrimary} />} onPress={() => { close(); router.push({ pathname: "/refund", params: { txn: row.id } }); }} /> : null}
          {canCorrect ? <PrimaryButton variant="ghost" label={t("ux.correct_entry")} icon={<AppIcon name="pen" size={18} color={c.brandPrimary} />} onPress={() => setCorrecting(true)} /> : null}
        </View>
      )}
    </Sheet>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.line}>
      <Text style={type.caption}>{label}</Text>
      <Text selectable numberOfLines={1} style={[type.label, { flexShrink: 1, textAlign: "right" }]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: tokens.space[3], paddingVertical: 10, paddingHorizontal: tokens.space[3], backgroundColor: c.surface, borderRadius: tokens.radius.md },
  rowManual: { backgroundColor: c.manualTint, borderWidth: 1, borderColor: c.manualBorder },
  meta: { flexDirection: "row", alignItems: "center", gap: 6 },
  struck: { textDecorationLine: "line-through", color: c.textMuted },
  hero: { alignItems: "center", gap: 6, padding: tokens.space[4], borderRadius: tokens.radius.lg, backgroundColor: c.surface },
  heroManual: { backgroundColor: c.manualTint, borderWidth: 1, borderColor: c.manualBorder },
  card: { backgroundColor: c.surface, borderRadius: tokens.radius.lg, paddingHorizontal: tokens.space[4] },
  line: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: tokens.space[3], minHeight: 48 },
});
