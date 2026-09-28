CREATE TABLE IF NOT EXISTS watchlist (
  pubkey text PRIMARY KEY CHECK (pubkey ~ '^0x[0-9a-f]{96}$'),
  friendly_name text NOT NULL,
  approved_destination text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS observations (
  id bigserial PRIMARY KEY,
  pubkey text NOT NULL REFERENCES watchlist(pubkey),
  source text NOT NULL,
  state_id text NOT NULL,
  observed_at timestamptz NOT NULL,
  slot bigint,
  epoch bigint,
  finalized boolean NOT NULL,
  execution_optimistic boolean NOT NULL DEFAULT false,
  validator_index bigint,
  lifecycle_status text NOT NULL,
  balance_gwei numeric(30,0) NOT NULL,
  effective_balance_gwei numeric(30,0) NOT NULL,
  withdrawal_credentials text NOT NULL,
  slashed boolean NOT NULL,
  activation_eligibility_epoch text,
  activation_epoch text,
  exit_epoch text,
  withdrawable_epoch text,
  UNIQUE(pubkey, source, state_id, slot)
);
CREATE INDEX IF NOT EXISTS observations_lookup ON observations(pubkey, observed_at DESC);
CREATE TABLE IF NOT EXISTS collection_runs (
  id bigserial PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  source text NOT NULL,
  outcome text NOT NULL,
  detail text,
  found_count integer NOT NULL DEFAULT 0,
  missing_count integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS collection_gaps (
  id bigserial PRIMARY KEY,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  source text NOT NULL,
  reason text NOT NULL,
  UNIQUE(start_at,end_at,source)
);
CREATE TABLE IF NOT EXISTS incidents (
  id bigserial PRIMARY KEY,
  incident_key text NOT NULL UNIQUE,
  pubkey text REFERENCES watchlist(pubkey),
  severity text NOT NULL,
  title text NOT NULL,
  detail text NOT NULL,
  evidence text,
  first_observed_at timestamptz NOT NULL DEFAULT now(),
  last_observed_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  note text,
  resolved_at timestamptz
);
INSERT INTO watchlist(pubkey,friendly_name) VALUES
 ('0x85c959e693d62a09f2b812b262b3666f22de507f308e3e8afed013aff1c3eebbf8a1605f724cc095a19bcb6fe856f19a','Validator 01'),
 ('0x8d710f3f863da677d10059183dd6b9e50e445f2f68bde6b8b2c31444819fe35493c0303ae2d7126ef2e7b942c3fae970','Validator 02'),
 ('0x8b9212fd8dbb5b384df6466ec8c4c7693d2f6596bd13fa7d14a8502a9d99baf9cb082708b426b8a210b76ec162df5102','Validator 03')
ON CONFLICT (pubkey) DO NOTHING;
