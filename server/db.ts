// SQLite (node:sqlite DatabaseSync) — single writer, WAL, PRAGMA user_version migrations. One file at DATA_DIR/wayve.db.
// observations are IMMUTABLE (triggers reject UPDATE/DELETE). zones / incidents / tasks are the mutable world state.
// Raw images and audio are never written anywhere: only the structured model output is stored.
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { inferZoneType } from '../shared/contracts.ts';
import { log } from './log.ts';

const MIGRATIONS: string[] = [
  `
  CREATE TABLE events (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    join_code TEXT NOT NULL UNIQUE,
    admin_key TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE zones (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    polygon_json TEXT NOT NULL,
    current_status TEXT NOT NULL DEFAULT 'unknown',
    status_reason TEXT,
    crowd_level TEXT,
    people_estimate INTEGER,
    last_observed_at INTEGER,
    version INTEGER NOT NULL DEFAULT 1,
    sort INTEGER NOT NULL DEFAULT 0,
    deleted_at INTEGER
  );
  CREATE INDEX zones_event ON zones(event_id);

  CREATE TABLE participants (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','staff','camera')),
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );
  CREATE INDEX participants_event ON participants(event_id, role);

  CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    zone_id TEXT REFERENCES zones(id) ON DELETE SET NULL,
    device_type TEXT NOT NULL CHECK (device_type IN ('camera','reporter')),
    status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','observing','paused')),
    label TEXT NOT NULL,
    last_seen_at INTEGER NOT NULL,
    last_frame_at INTEGER,
    last_error TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX devices_event ON devices(event_id);

  CREATE TABLE observations (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    zone_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    participant_id TEXT NOT NULL,
    modality TEXT NOT NULL CHECK (modality IN ('vision','voice','text','manual')),
    payload_json TEXT NOT NULL,
    confidence REAL NOT NULL,
    model TEXT,
    latency_ms INTEGER,
    observed_at INTEGER NOT NULL
  );
  CREATE INDEX observations_event ON observations(event_id, observed_at DESC);
  CREATE INDEX observations_zone ON observations(zone_id, observed_at DESC);
  CREATE TRIGGER observations_no_update BEFORE UPDATE ON observations BEGIN SELECT RAISE(ABORT, 'observations are immutable'); END;
  CREATE TRIGGER observations_no_delete BEFORE DELETE ON observations BEGIN SELECT RAISE(ABORT, 'observations are immutable'); END;

  CREATE TABLE incidents (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    zone_id TEXT NOT NULL,
    incident_type TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
    description TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_evidence_at INTEGER NOT NULL,
    resolved_at INTEGER,
    resolved_by TEXT
  );
  CREATE INDEX incidents_dedupe ON incidents(event_id, zone_id, incident_type, status, last_evidence_at);

  CREATE TABLE incident_observations (
    incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    observation_id TEXT NOT NULL,
    linked_at INTEGER NOT NULL,
    PRIMARY KEY (incident_id, observation_id)
  );
  CREATE INDEX io_observation ON incident_observations(observation_id);

  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    assignee_id TEXT,
    title TEXT NOT NULL,
    steps_json TEXT NOT NULL DEFAULT '[]',
    steps_source TEXT NOT NULL DEFAULT 'pending' CHECK (steps_source IN ('ai','rule','pending')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','done')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX tasks_event ON tasks(event_id, status);

  CREATE TABLE activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    ref TEXT,
    at INTEGER NOT NULL
  );
  CREATE INDEX activity_event ON activity(event_id, id DESC);
  `,
  // v2 — attendee chatbot: participants may be 'attendee' (role CHECK rebuilt), attendee location, every chat turn stored.
  `
  CREATE TABLE participants__v2 (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','staff','camera','attendee')),
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    zone_id TEXT
  );
  INSERT INTO participants__v2 (id, event_id, display_name, role, token_hash, created_at, last_seen_at)
    SELECT id, event_id, display_name, role, token_hash, created_at, last_seen_at FROM participants;
  DROP TABLE participants;
  ALTER TABLE participants__v2 RENAME TO participants;
  CREATE INDEX participants_event ON participants(event_id, role);

  CREATE TABLE chat_messages (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    participant_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user','assistant')),
    text TEXT NOT NULL,
    zone_id TEXT,
    observation_id TEXT,
    model TEXT,
    at INTEGER NOT NULL
  );
  CREATE INDEX chat_participant ON chat_messages(participant_id, at);
  CREATE INDEX chat_event ON chat_messages(event_id, at DESC);
  `,
  // v3 — observations.modality accepts 'chat' (attendee chatbot). Table rebuild keeps rows; triggers + indexes recreated.
  `
  CREATE TABLE observations__v3 (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    zone_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    participant_id TEXT NOT NULL,
    modality TEXT NOT NULL CHECK (modality IN ('vision','voice','text','manual','chat')),
    payload_json TEXT NOT NULL,
    confidence REAL NOT NULL,
    model TEXT,
    latency_ms INTEGER,
    observed_at INTEGER NOT NULL
  );
  INSERT INTO observations__v3 SELECT id, event_id, zone_id, device_id, participant_id, modality, payload_json, confidence, model, latency_ms, observed_at FROM observations;
  DROP TABLE observations;
  ALTER TABLE observations__v3 RENAME TO observations;
  CREATE INDEX observations_event ON observations(event_id, observed_at DESC);
  CREATE INDEX observations_zone ON observations(zone_id, observed_at DESC);
  CREATE TRIGGER observations_no_update BEFORE UPDATE ON observations BEGIN SELECT RAISE(ABORT, 'observations are immutable'); END;
  CREATE TRIGGER observations_no_delete BEFORE DELETE ON observations BEGIN SELECT RAISE(ABORT, 'observations are immutable'); END;
  `,
  // v4 — ops tracker: teams, immutable utterances, issues + append-only issue_events, proposals inbox, talk messages + acks.
  `
  CREATE TABLE teams (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0,
    deleted_at INTEGER
  );
  CREATE INDEX teams_event ON teams(event_id);
  ALTER TABLE participants ADD COLUMN team_id TEXT;

  CREATE TABLE devices__v4 (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    zone_id TEXT REFERENCES zones(id) ON DELETE SET NULL,
    device_type TEXT NOT NULL CHECK (device_type IN ('camera','reporter','scribe')),
    status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','observing','paused')),
    label TEXT NOT NULL,
    last_seen_at INTEGER NOT NULL,
    last_frame_at INTEGER,
    last_error TEXT,
    created_at INTEGER NOT NULL
  );
  INSERT INTO devices__v4 SELECT id, event_id, participant_id, zone_id, device_type, status, label, last_seen_at, last_frame_at, last_error, created_at FROM devices;
  DROP TABLE devices;
  ALTER TABLE devices__v4 RENAME TO devices;
  CREATE INDEX devices_event ON devices(event_id);

  CREATE TABLE utterances (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    team_id TEXT,
    device_id TEXT NOT NULL,
    participant_id TEXT NOT NULL,
    speaker TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('scribe','talk','chat','report')),
    text TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER NOT NULL,
    model TEXT,
    latency_ms INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX utterances_event ON utterances(event_id, started_at DESC);
  CREATE INDEX utterances_device ON utterances(device_id, started_at DESC);
  CREATE TRIGGER utterances_no_update BEFORE UPDATE ON utterances BEGIN SELECT RAISE(ABORT, 'utterances are immutable'); END;
  CREATE TRIGGER utterances_no_delete BEFORE DELETE ON utterances BEGIN SELECT RAISE(ABORT, 'utterances are immutable'); END;

  CREATE TABLE issues (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    title TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('task','problem','decision','question')),
    status TEXT NOT NULL CHECK (status IN ('open','in_progress','blocked','done')),
    priority TEXT NOT NULL CHECK (priority IN ('p0','p1','p2','p3')),
    team_id TEXT,
    assignee_id TEXT,
    assignee_hint TEXT,
    due_at INTEGER,
    zone_id TEXT,
    created_by TEXT NOT NULL CHECK (created_by IN ('ai','human','rule')),
    incident_id TEXT,
    escalated INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    UNIQUE (event_id, number)
  );
  CREATE INDEX issues_event ON issues(event_id, status, updated_at DESC);
  CREATE INDEX issues_incident ON issues(incident_id);

  CREATE TABLE issue_evidence (
    issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    ref_type TEXT NOT NULL CHECK (ref_type IN ('utterance','observation')),
    ref_id TEXT NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (issue_id, ref_type, ref_id)
  );
  CREATE INDEX issue_evidence_ref ON issue_evidence(ref_type, ref_id);

  CREATE TABLE issue_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    field TEXT,
    from_raw TEXT,
    to_raw TEXT,
    from_label TEXT,
    to_label TEXT,
    actor TEXT NOT NULL CHECK (actor IN ('ai','rule','human')),
    actor_id TEXT,
    actor_name TEXT NOT NULL,
    evidence_json TEXT NOT NULL DEFAULT '[]',
    confidence REAL,
    undone INTEGER NOT NULL DEFAULT 0,
    at INTEGER NOT NULL
  );
  CREATE INDEX issue_events_issue ON issue_events(issue_id, id DESC);
  CREATE INDEX issue_events_event ON issue_events(event_id, id DESC);

  CREATE TABLE proposals (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('pending','accepted','rejected')),
    action_json TEXT NOT NULL,
    summary TEXT NOT NULL,
    confidence REAL NOT NULL,
    evidence_json TEXT NOT NULL,
    issue_id TEXT,
    created_at INTEGER NOT NULL,
    decided_at INTEGER,
    decided_by TEXT
  );
  CREATE INDEX proposals_event ON proposals(event_id, status, created_at DESC);

  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    from_id TEXT NOT NULL,
    to_type TEXT NOT NULL CHECK (to_type IN ('hq','team','person','all')),
    to_id TEXT,
    to_label TEXT NOT NULL,
    text TEXT NOT NULL,
    utterance_id TEXT NOT NULL,
    expected_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX messages_event ON messages(event_id, created_at DESC);
  CREATE TABLE message_acks (
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    participant_id TEXT NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (message_id, participant_id)
  );
  `,
  // v5 — accounts (ID login), floor-plan map, field reports, walkie-talkie audio clips.
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  ALTER TABLE participants ADD COLUMN user_id TEXT;
  CREATE INDEX participants_user ON participants(user_id, event_id);
  ALTER TABLE events ADD COLUMN map_json TEXT;
  ALTER TABLE events ADD COLUMN owner_user_id TEXT;
  ALTER TABLE messages ADD COLUMN audio_path TEXT;
  ALTER TABLE messages ADD COLUMN duration_ms INTEGER;
  CREATE TABLE reports (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL,
    zone_id TEXT,
    category TEXT NOT NULL,
    urgency TEXT NOT NULL,
    text TEXT,
    transcript TEXT,
    photo_path TEXT,
    ai_json TEXT,
    issue_id TEXT,
    observation_id TEXT,
    parent_report_id TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX reports_event ON reports(event_id, created_at DESC);
  CREATE INDEX reports_issue ON reports(issue_id);
  `,
  // v6 — event knowledge for the assistant; camera calibration (regions on the camera's own view + snapshot).
  `
  ALTER TABLE events ADD COLUMN knowledge TEXT;
  ALTER TABLE events ADD COLUMN knowledge_updated_at INTEGER;
  ALTER TABLE devices ADD COLUMN regions_json TEXT;
  ALTER TABLE devices ADD COLUMN snapshot_path TEXT;
  `,
  // v7 — where a device sits on the venue map (map coordinates).
  `
  ALTER TABLE devices ADD COLUMN position_json TEXT;
  `,  // v8 — zone tracking: zone type, queue-rate override, derived track state, 30-s metric buckets (sparklines, trend, CSV).
  `
  ALTER TABLE zones ADD COLUMN zone_type TEXT NOT NULL DEFAULT 'general';
  ALTER TABLE zones ADD COLUMN queue_rate REAL;
  ALTER TABLE zones ADD COLUMN track_json TEXT;
  ALTER TABLE zones ADD COLUMN last_service_at INTEGER;
  CREATE TABLE zone_metrics (
    zone_id    TEXT    NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
    bucket     INTEGER NOT NULL,
    event_id   TEXT    NOT NULL,
    n_obs      INTEGER NOT NULL DEFAULT 0,
    n_ok       INTEGER NOT NULL DEFAULT 0,
    crowd      REAL,
    people     REAL,
    queue      REAL,
    wait_min   REAL,
    seats_free REAL,
    walkway    INTEGER,
    hazard     REAL,
    tier       INTEGER,
    status     TEXT,
    conf       REAL,
    PRIMARY KEY (zone_id, bucket)
  ) WITHOUT ROWID;
  CREATE INDEX zone_metrics_event ON zone_metrics(event_id, bucket);
  `,
  // v9 — AI crew: personas bound to devices/zones, their posts, and issues they watch & verify.
  `
  CREATE TABLE agents (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    instructions TEXT NOT NULL,
    device_id TEXT,
    zone_ids_json TEXT NOT NULL DEFAULT '[]',
    team_id TEXT,
    participant_id TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    last_action TEXT,
    last_action_at INTEGER,
    stat_obs INTEGER NOT NULL DEFAULT 0,
    stat_posts INTEGER NOT NULL DEFAULT 0,
    stat_issues INTEGER NOT NULL DEFAULT 0,
    deleted_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX agents_event ON agents(event_id);
  CREATE TABLE agent_posts (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    issue_id TEXT,
    at INTEGER NOT NULL
  );
  CREATE INDEX agent_posts_event ON agent_posts(event_id, at DESC);
  CREATE TABLE agent_watches (
    issue_id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    since INTEGER NOT NULL,
    normal_since INTEGER
  );
  `,  // v10 — invites: shareable links (sha256 only), role + team, expiry, use limits, revoke.
  `
  CREATE TABLE invites (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('admin','staff')),
    team_id TEXT,
    created_by TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    max_uses INTEGER,
    uses INTEGER NOT NULL DEFAULT 0,
    revoked_at INTEGER,
    note TEXT
  );
  CREATE INDEX invites_event ON invites(event_id, created_at DESC);
  `,
];

fs.mkdirSync(config.DATA_DIR, { recursive: true });
export const db = new DatabaseSync(path.join(config.DATA_DIR, 'wayve.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');

{
  const cur = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  db.exec('PRAGMA foreign_keys = OFF');
  for (let v = cur; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
      log.info('db.migrated', { to: v + 1 });
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  db.exec('PRAGMA foreign_keys = ON');
  // v8 backfill: guess each existing zone's type from its name (the admin can change it).
  if (cur < 8 && MIGRATIONS.length >= 8) {
    for (const z of db.prepare('SELECT id, name FROM zones').all() as Array<{ id: string; name: string }>) {
      db.prepare('UPDATE zones SET zone_type = ? WHERE id = ?').run(inferZoneType(z.name), z.id);
    }
  }
  // zone_metrics retention: 7 days.
  try { db.prepare('DELETE FROM zone_metrics WHERE bucket < ?').run(Date.now() - 7 * 86_400_000); } catch { /* table may not exist yet */ }
}

const cache = new Map<string, StatementSync>();
const stmt = (sql: string) => {
  let s = cache.get(sql);
  if (!s) { s = db.prepare(sql); cache.set(sql, s); }
  return s;
};

export const q = {
  get: <T>(sql: string, ...p: SQLInputValue[]) => stmt(sql).get(...p) as T | undefined,
  all: <T>(sql: string, ...p: SQLInputValue[]) => stmt(sql).all(...p) as T[],
  run: (sql: string, ...p: SQLInputValue[]) => stmt(sql).run(...p),
};

/** Run fn inside one transaction (single writer: every world mutation is atomic). */
export function tx<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw e;
  }
}
