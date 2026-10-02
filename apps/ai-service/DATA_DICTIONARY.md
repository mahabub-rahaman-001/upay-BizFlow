# DATA_DICTIONARY — BizFlow AI Service (P6)

All monetary values are integer **poisha** (bigint). 1 taka = 100 poisha.
Time zone: `Asia/Dhaka` (UTC+6). No floats for money.

---

## 1. Source tables (Supabase Postgres)

| Table | Used by | Key columns |
|-------|---------|-------------|
| `transactions` | AI-01, AI-02, AI-03, AI-04 | `business_id`, `kind`, `source`, `amount_minor`, `occurred_at`, `wallet`, `category`, `actor_user_id` |
| `journal_lines` | AI-01 | `business_id`, `account_id`, `debit_minor`, `credit_minor` |
| `closings` | AI-01, AI-04 | `business_id`, `period_date`, `variance_minor`, `counted_cash_minor` |
| `agent_float_audits` | AI-02 | `business_id`, `period_date`, `cash_variance_minor`, `upay_variance_minor` |
| `businesses` | all | `id`, `type`, `category`, `location_type`, `settings` |
| `memberships` | AI-04 | `user_id`, `business_id`, `role` |
| `ai_outputs` | serving | `business_id`, `capability`, `payload`, `model_version`, `confidence` |
| `forecast_runs` | serving | `business_id`, `cutoff_date`, `model_version`, `days` (jsonb) |

---

## 2. Calendar features (computed at feature build time)

| Feature | Type | Description |
|---------|------|-------------|
| `dow` | int 0-6 | Day of week (0=Monday, 6=Sunday) |
| `is_weekend_bd` | bool | Friday (4) or Saturday (5) -- Bangladeshi weekend |
| `day_of_month` | int 1-31 | Calendar day |
| `is_salary_week` | bool | day_of_month in 1-7 (salary disbursements) |
| `is_month_end` | bool | day_of_month >= 25 |
| `month` | int 1-12 | Calendar month |
| `week_of_year` | int 1-53 | ISO week number |
| `is_ramadan` | bool | Ramadan window (config-driven per year) |
| `ramadan_day_index` | int or -1 | Day within Ramadan (1-30); -1 outside |
| `is_eid_window` | bool | Eid-ul-Fitr or Eid-ul-Adha: 7 days before to 3 days after |
| `is_pohela_boishakh` | bool | 14 April (Bangla New Year) |
| `is_public_holiday` | bool | BD public holidays (config list) |
| `is_exam_season` | bool | SSC/HSC exam periods (campus location_type only) |

---

## 3. AI-01 -- Sales forecast features (daily, per merchant)

### Lag features
| Feature | Description |
|---------|-------------|
| `sales_d1` | Net sales D-1 (poisha) |
| `sales_d7` | Net sales D-7 |
| `sales_d14` | Net sales D-14 |
| `sales_d28` | Net sales D-28 |
| `sales_same_dow_1w` | Same weekday 1 week ago |
| `sales_same_dow_2w` | Same weekday 2 weeks ago |
| `sales_same_dow_3w` | Same weekday 3 weeks ago |
| `sales_same_dow_4w` | Same weekday 4 weeks ago |

### Rolling aggregates
| Feature | Description |
|---------|-------------|
| `sales_mean_3d` | 3-day rolling mean |
| `sales_mean_7d` | 7-day rolling mean |
| `sales_mean_14d` | 14-day rolling mean |
| `sales_mean_28d` | 28-day rolling mean |
| `sales_median_7d` | 7-day rolling median |
| `sales_std_7d` | 7-day rolling std |
| `sales_std_28d` | 28-day rolling std |
| `sales_ewma_7d` | EWMA span=7 |

### Mix features
| Feature | Description |
|---------|-------------|
| `digital_share_7d` | QR payments / total sales last 7 days |
| `digital_share_28d` | Same last 28 days |
| `avg_ticket_7d` | Mean transaction amount last 7 days |
| `txn_count_7d` | Transaction count last 7 days |
| `refund_rate_28d` | Refund amount / gross sales last 28 days |

### Business features (static or slow-changing)
| Feature | Description |
|---------|-------------|
| `category` | Encoded: grocery=0, restaurant=1, pharmacy=2, clothing=3, other=4 |
| `location_type` | Encoded: urban=0, campus=1, rural=2 |
| `business_age_days` | Days since first transaction |

### Data quality features
| Feature | Description |
|---------|-------------|
| `missing_days_28d` | Days with no transactions in last 28 |
| `days_since_last_closing` | Days since most recent closing record |
| `manual_entry_share_7d` | Manual / total transactions last 7 days |
| `has_active_offer` | Boolean: active offer on this day |

### Target
| Column | Description |
|--------|-------------|
| `sales_minor` | Net sales (poisha) for the day |

---

## 4. AI-02 -- Agent float forecast features (hourly, per agent)

### Lag features (hourly)
| Feature | Description |
|---------|-------------|
| `demand_h1` | Net cash demand 1 hour ago |
| `demand_same_hour_1w` | Same hour same weekday 1 week ago |
| `demand_same_hour_2w` | 2 weeks ago |
| `demand_same_hour_3w` | 3 weeks ago |
| `demand_same_hour_4w` | 4 weeks ago |

### Rolling (hourly)
| Feature | Description |
|---------|-------------|
| `demand_mean_4h` | 4-hour rolling mean |
| `demand_mean_24h` | 24-hour rolling mean |
| `running_cash_demand_today` | Cumulative net demand since midnight |
| `running_efloat_change_today` | Cumulative e-float change since midnight |

### Calendar (hourly)
| Feature | Description |
|---------|-------------|
| `hour` | 0-23 |
| `is_haat_day` | Weekly market day for rural agents (config) |
| `is_remittance_surge` | Proxy: 1st and 15th of month |
| All §2 calendar features | Same as merchant |

### Targets (two models)
| Column | Description |
|--------|-------------|
| `net_cash_demand_minor` | cash_out - cash_in for the hour |
| `efloat_demand_minor` | e-float used (send_money + cash_out) for the hour |

---

## 5. AI-03 -- Match scorer features (per candidate pair)

| Feature | Description |
|---------|-------------|
| `amount_diff_minor` | abs(txn.amount - candidate.amount) |
| `amount_rel_diff` | amount_diff / txn.amount |
| `time_gap_hours` | abs(txn.occurred_at - candidate.occurred_at) in hours |
| `reference_sim` | Jaro-Winkler similarity of reference strings (0-1) |
| `reference_token_overlap` | Token overlap after Bangla/EN digit normalization |
| `same_staff` | Boolean: same actor_user_id |
| `customer_repeat_link` | Boolean: same payer_hash (consented) |
| `invoice_age_days` | Days since candidate was created |
| `typical_payment_delay` | Customer historical median payment delay (days) |
| `exact_reference_and_amount` | Boolean: deterministic rule -- auto-match if True |

---

## 6. AI-04 -- Anomaly features

### Per-transaction (rules + statistical)
| Feature | Description |
|---------|-------------|
| `amount_vs_p99` | amount_minor / p99 of business last 90 days |
| `is_outside_hours` | occurred_at outside business opening hours |
| `is_duplicate_60s` | Same amount + same payer_hash within 60 s |
| `refund_vs_30d_mean` | refund amount / 30-day daily mean refund |
| `staff_reversal_count_7d` | Reversals by same actor in last 7 days |
| `closing_variance_streak` | Consecutive days with |variance| > tolerance |

### Per-day business vector (IsolationForest)
| Feature | Description |
|---------|-------------|
| `txn_count` | Total transactions |
| `refund_count` | Refund transactions |
| `manual_count` | Manual-source transactions |
| `late_night_share` | Transactions 22:00-05:00 / total |
| `cash_mix` | Cash sales / total |
| `split_txn_score` | Many just-below-limit txns from same payer_hash |
| `variance_minor` | Absolute closing variance (0 if no closing) |
| `reversal_rate` | Reversals / total |

---

## 7. Reason codes (Bangla) -- AI-04

| Code | bn label |
|------|----------|
| `DUPLICATE_PAYMENT` | একই পরিমাণ ও পেয়ার ৬০ সেকেন্ডের মধ্যে |
| `LARGE_AMOUNT` | স্বাভাবিকের চেয়ে অনেক বড় পরিমাণ |
| `OUTSIDE_HOURS` | ব্যবসার সময়ের বাইরে |
| `HIGH_REFUND` | অস্বাভাবিক বেশি রিফান্ড |
| `REPEATED_REVERSAL` | একই কর্মীর বারবার বাতিল |
| `VARIANCE_STREAK` | টানা কয়েকদিন হিসাবে পার্থক্য |
| `STATISTICAL_OUTLIER` | পরিসংখ্যানগতভাবে অস্বাভাবিক |
| `ML_ANOMALY` | ML মডেল সন্দেহজনক চিহ্নিত করেছে |

Label: always `needs_review` -- never `fraud`.

---

## 8. Model output schema (stored in `ai_outputs`)

```json
{
  "capability": "sales_forecast",
  "business_id": "uuid",
  "model_version": "lgbm-quantile-0.1.0",
  "feature_version": "v1",
  "confidence": "high | medium | low",
  "abstained": false,
  "reason": null,
  "payload": {},
  "input_hash": "sha256 of request",
  "latency_ms": 42,
  "created_at": "2026-10-02T20:00:00+06:00"
}
```

---

## 9. Synthetic data parameters

| Parameter | Value |
|-----------|-------|
| Merchants | 12 (3 grocery, 2 restaurant, 2 pharmacy, 2 clothing, 3 other) |
| Agents | 6 (urban, campus, rural mix) |
| History | 180 days ending today |
| Random seed | 42 (reproducible) |
| Salary day spike | +40-70% sales on days 1-3 of month |
| Weekend pattern | Friday -20% (closed or slow); Saturday +10% |
| Eid window | +150% pre-Eid, -60% Eid day, +30% post-3 days |
| Agent cash-out peak | 09:00-11:00 and 15:00-17:00 |
