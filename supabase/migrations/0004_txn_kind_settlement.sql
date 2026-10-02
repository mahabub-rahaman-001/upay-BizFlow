-- Adds the SETTLEMENT transaction kind. It lives in its own migration because Postgres
-- will not let a new enum label be used in the same transaction that added it, and the
-- ingress functions in 0005 post with this label.
alter type txn_kind add value if not exists 'SETTLEMENT';
