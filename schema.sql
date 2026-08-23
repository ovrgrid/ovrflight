-- OVRFLIGHT D1 schema (database: ovrflight)
-- Apply manually: wrangler d1 execute ovrflight --file schema.sql --remote
-- Never applied by the deploy pipeline. See flight/SPEC.md section 3.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  name TEXT NOT NULL,
  designation TEXT NOT NULL DEFAULT 'commercial'
    CHECK (designation IN ('hobbyist','commercial','first_responder','police','fire')),
  designation_status TEXT NOT NULL DEFAULT 'active'
    CHECK (designation_status IN ('active','pending','rejected')),
  platform_role TEXT NOT NULL DEFAULT 'user'
    CHECK (platform_role IN ('super_admin','staff','user')),
  part107_cert TEXT,
  part107_verified INTEGER NOT NULL DEFAULT 0,
  -- NTHSKY SSO link (ACCESS-STANDARD §9.2): the hub user id this local row is
  -- merged with. Match on email, store the uid, keep users.id stable forever.
  nthsky_uid TEXT,
  last_login TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_nthsky ON users(nthsky_uid);

-- ACCESS-STANDARD §9.3: a failed sign-in must be diagnosable without the user
-- reporting exact wording. Minimal for now; grows into CORE-4 telemetry.
CREATE TABLE IF NOT EXISTS app_errors (
  id TEXT PRIMARY KEY,
  message TEXT NOT NULL,
  source TEXT,
  context TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'commercial'
    CHECK (kind IN ('commercial','agency','dept','personal')),
  default_visibility TEXT NOT NULL DEFAULT 'all'
    CHECK (default_visibility IN ('all','team','org_share')),
  feed_enabled INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS org_members (
  user_id TEXT NOT NULL REFERENCES users(id),
  org_id TEXT NOT NULL REFERENCES organizations(id),
  org_role TEXT NOT NULL DEFAULT 'member'
    CHECK (org_role IN ('admin','member','viewer')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, org_id)
);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS team_members (
  user_id TEXT NOT NULL REFERENCES users(id),
  team_id TEXT NOT NULL REFERENCES teams(id),
  PRIMARY KEY (user_id, team_id)
);

-- Verified-track queue for elevated designations (first_responder/police/fire).
CREATE TABLE IF NOT EXISTS verifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  requested_designation TEXT NOT NULL,
  agency_name TEXT,
  contact_email TEXT,
  evidence_ref TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Ingest + machine-read auth. Key value shown once; only the hash is stored.
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  label TEXT NOT NULL,
  key_hash TEXT UNIQUE NOT NULL,
  scopes TEXT NOT NULL DEFAULT 'ingest,read',
  last_used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

CREATE TABLE IF NOT EXISTS aircraft (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  label TEXT NOT NULL,
  class TEXT NOT NULL DEFAULT 'drone' CHECK (class IN ('drone','heli','fixed_wing')),
  remote_id TEXT,
  serial TEXT,
  default_pilot_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_aircraft_org ON aircraft(org_id);

-- Flight summaries. Full raw track always archived to R2 (track_ref); platform copy
-- is never deleted even if the owner hides it (deleted_by_owner flag).
CREATE TABLE IF NOT EXISTS flights (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  aircraft_key TEXT NOT NULL,
  aircraft_id TEXT REFERENCES aircraft(id),
  pilot_id TEXT REFERENCES users(id),
  class TEXT NOT NULL DEFAULT 'drone',
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_s INTEGER,
  max_alt_agl_ft REAL,
  distance_m REAL,
  point_count INTEGER NOT NULL DEFAULT 0,
  summary_json TEXT,
  track_ref TEXT,
  deleted_by_owner INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_flights_org ON flights(org_id, started_at);

-- Pre-planned missions: soft area claiming / deconfliction.
CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  center_lat REAL NOT NULL,
  center_lon REAL NOT NULL,
  radius_m REAL NOT NULL DEFAULT 800,
  floor_alt_ft REAL NOT NULL DEFAULT 0,
  ceiling_alt_ft REAL NOT NULL DEFAULT 400,
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','active','done','cancelled')),
  visibility TEXT NOT NULL DEFAULT 'all',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_missions_window ON missions(window_start, window_end);

-- Org-to-org sharing grants (identity/telemetry layers above the presence floor).
CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY,
  from_org_id TEXT NOT NULL REFERENCES organizations(id),
  to_org_id TEXT NOT NULL REFERENCES organizations(id),
  scope TEXT NOT NULL DEFAULT 'all' CHECK (scope IN ('all','team')),
  team_id TEXT REFERENCES teams(id),
  layer TEXT NOT NULL DEFAULT 'telemetry'
    CHECK (layer IN ('presence','identity','telemetry','logs')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Small key/value store for connector state and runtime switches.
-- Keys in use: opensky_token (cached OAuth), adsb_status (poll heartbeat),
-- signups_open ('true' opens public signup; ANY other value or a missing row
-- keeps it closed - the read fails closed on purpose).
CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS share_events (
  id TEXT PRIMARY KEY,
  share_id TEXT REFERENCES shares(id),
  actor TEXT,
  action TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ==================== NTHSKY FEDERATION: SITE BUILD BOARD ====================
-- OVRFLIGHT's own task board, read AND managed by the NTHSKY hub over the shared
-- federation key (flight-worker/worker.js: /api/nthsky/tasks). Applied to the
-- live D1 on 2026-08-02 via the Cloudflare API (idempotent - safe to re-run).
CREATE TABLE IF NOT EXISTS platform_tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  details TEXT,
  section TEXT NOT NULL DEFAULT 'general',   -- launch | data | security | product | ...
  priority INTEGER,                          -- 1 = now, 2 = next, 3 = later, NULL = untriaged
  status TEXT NOT NULL DEFAULT 'open',       -- open | doing | waiting | done | dropped
  needs TEXT,                                -- what unblocks it (esp. owner-side steps)
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  done_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ptasks_status ON platform_tasks(status, section, priority);
