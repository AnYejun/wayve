// Live data (observable DB + CSV export) and organizer knowledge. Read-only views over an explicit column whitelist:
// secrets (token_hash, password_hash, admin_key) and raw storage paths are never exposed. Admin only.
import express from 'express';
import { z } from 'zod';
import { DATA_TABLES, RADIO_AUDIO_TTL_MS, type DataPage, type DataTable, type EventKnowledge } from '../shared/contracts.ts';
import { config } from './config.ts';
import { q } from './db.ts';
import { HttpErr, h, notFound, parse, requireRole } from './routes.ts';
import { getEvent, getKnowledge } from './world.ts';

type Row = Record<string, string | number | null>;

const TS = new Intl.DateTimeFormat('sv-SE', { timeZone: config.EVENT_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const fmtTs = (v: unknown) => (typeof v === 'number' && v > 0 ? TS.format(v) : null);

function payloadSummary(json: string | null): string | null {
  if (!json) return null;
  try {
    const p = JSON.parse(json) as { kind: string; summary?: string; transcript?: string; note?: string | null; issue_type?: string | null; crowd_level?: string | null };
    if (p.kind === 'vision') return p.summary ?? null;
    if (p.kind === 'report') return p.transcript ?? p.summary ?? null;
    return [p.crowd_level, p.issue_type, p.note].filter(Boolean).join(' · ') || null;
  } catch { return null; }
}

/** One SQL per table (explicit columns), plus an optional row mapper. Timestamps (*_at) become local "YYYY-MM-DD HH:MM:SS". */
const TABLES: Record<DataTable, { sql: string; map?: (r: Row) => Row }> = {
  issues: {
    sql: `SELECT 'WV-' || i.number AS key, i.title, i.kind, i.status, i.priority, t.name AS team, p.display_name AS assignee, i.assignee_hint AS mentioned,
            i.due_at, z.name AS zone, i.created_by, i.escalated, i.incident_id, i.created_at, i.updated_at
          FROM issues i LEFT JOIN teams t ON t.id = i.team_id LEFT JOIN participants p ON p.id = i.assignee_id LEFT JOIN zones z ON z.id = i.zone_id
          WHERE i.event_id = ? ORDER BY i.number DESC`,
  },
  reports: {
    sql: `SELECT r.id, r.created_at, p.display_name AS author, z.name AS zone, r.category, r.urgency, r.text, r.transcript, r.photo_path, r.ai_json,
            'WV-' || i.number AS issue, r.parent_report_id
          FROM reports r LEFT JOIN participants p ON p.id = r.author_id LEFT JOIN zones z ON z.id = r.zone_id LEFT JOIN issues i ON i.id = r.issue_id
          WHERE r.event_id = ? ORDER BY r.created_at DESC`,
    map: (r) => {
      let ai: { title?: string; summary?: string; confidence?: number } = {};
      try { ai = r.ai_json ? JSON.parse(String(r.ai_json)) : {}; } catch { /* keep empty */ }
      const { photo_path, ai_json, ...rest } = r;
      void ai_json;
      return { ...rest, photo_url: photo_path ? `/media/${photo_path}` : null, ai_title: ai.title ?? null, ai_summary: ai.summary ?? null, ai_confidence: ai.confidence ?? null };
    },
  },
  utterances: {
    sql: `SELECT u.id, u.started_at, u.speaker, t.name AS team, u.source, u.text, u.model, u.latency_ms
          FROM utterances u LEFT JOIN teams t ON t.id = u.team_id WHERE u.event_id = ? ORDER BY u.started_at DESC`,
  },
  messages: {
    sql: `SELECT m.id, m.created_at, p.display_name AS sender, m.to_label AS recipient, m.text,
            (SELECT COUNT(*) FROM message_acks a WHERE a.message_id = m.id) AS acks, m.expected_json, m.audio_path, m.duration_ms
          FROM messages m LEFT JOIN participants p ON p.id = m.from_id WHERE m.event_id = ? ORDER BY m.created_at DESC`,
    map: (r) => {
      const { expected_json, audio_path, created_at, ...rest } = r;
      let expected = 0;
      try { expected = (JSON.parse(String(expected_json)) as string[]).length; } catch { /* 0 */ }
      const alive = audio_path && typeof created_at === 'number' && Date.now() - created_at < RADIO_AUDIO_TTL_MS;
      return { id: rest.id, created_at, ...rest, expected, audio_url: alive ? `/media/${audio_path}` : null };
    },
  },
  observations: {
    sql: `SELECT o.id, o.observed_at, z.name AS zone, COALESCE(d.label, p.display_name) AS source, o.modality, o.payload_json, o.confidence, o.model, o.latency_ms
          FROM observations o LEFT JOIN zones z ON z.id = o.zone_id LEFT JOIN devices d ON d.id = o.device_id LEFT JOIN participants p ON p.id = o.participant_id
          WHERE o.event_id = ? ORDER BY o.observed_at DESC`,
    map: (r) => {
      const { payload_json, ...rest } = r;
      return { ...rest, summary: payloadSummary(payload_json as string | null), confidence: typeof rest.confidence === 'number' ? Math.round(rest.confidence * 100) / 100 : null };
    },
  },
  issue_events: {
    sql: `SELECT e.id, e.at, 'WV-' || i.number AS issue, e.kind, e.from_label AS "from", e.to_label AS "to", e.actor, e.actor_name, e.confidence, e.undone
          FROM issue_events e JOIN issues i ON i.id = e.issue_id WHERE e.event_id = ? ORDER BY e.id DESC`,
  },
  proposals: {
    sql: `SELECT id, created_at, status, summary, confidence, decided_by, decided_at FROM proposals WHERE event_id = ? ORDER BY created_at DESC`,
  },
  zones: {
    sql: `SELECT id, name, current_status AS status, crowd_level, people_estimate, status_reason, last_observed_at, version
          FROM zones WHERE event_id = ? AND deleted_at IS NULL ORDER BY sort, rowid`,
  },
  participants: {
    sql: `SELECT p.id, p.display_name AS name, p.role, t.name AS team, u.username, p.last_seen_at, p.created_at
          FROM participants p LEFT JOIN teams t ON t.id = p.team_id LEFT JOIN users u ON u.id = p.user_id WHERE p.event_id = ? ORDER BY p.created_at`,
  },
  devices: {
    sql: `SELECT d.id, d.label, d.device_type AS type, p.display_name AS owner, z.name AS zone, d.status AS mode, d.last_seen_at, d.last_frame_at, d.last_error
          FROM devices d LEFT JOIN participants p ON p.id = d.participant_id LEFT JOIN zones z ON z.id = d.zone_id WHERE d.event_id = ? ORDER BY d.created_at`,
  },
  incidents: {
    sql: `SELECT n.id, n.created_at, z.name AS zone, n.incident_type AS type, n.severity, n.status, n.description, n.resolved_at
          FROM incidents n LEFT JOIN zones z ON z.id = n.zone_id WHERE n.event_id = ? ORDER BY n.created_at DESC`,
  },
};

const MAX_ROWS = 20_000;

function loadTable(eventId: string, table: DataTable): { columns: string[]; rows: Row[] } {
  const spec = TABLES[table];
  const raw = q.all<Row>(`${spec.sql} LIMIT ${MAX_ROWS}`, eventId);
  const rows = raw.map((r) => {
    const m = spec.map ? spec.map(r) : r;
    const out: Row = {};
    for (const [k, v] of Object.entries(m)) out[k] = k.endsWith('_at') ? fmtTs(v) : (v as string | number | null);
    return out;
  });
  const columns = rows.length ? Object.keys(rows[0]) : columnsOf(spec.sql, spec.map);
  return { columns, rows };
}

/** Column names for an empty table (map a fake row through the mapper). */
function columnsOf(sql: string, map?: (r: Row) => Row): string[] {
  const sel = sql.slice(sql.indexOf('SELECT') + 6, sql.indexOf('FROM'));
  const names = sel.split(/,(?![^(]*\))/).map((c) => {
    const m = /(?:AS\s+"?([\w]+)"?|\.?([\w]+))\s*$/i.exec(c.trim());
    return (m?.[1] ?? m?.[2] ?? c.trim()).replace(/"/g, '');
  });
  const fake = Object.fromEntries(names.map((n) => [n, null])) as Row;
  return Object.keys(map ? map(fake) : fake);
}

const csvCell = (v: string | number | null) => {
  if (v == null) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // spreadsheet formula injection guard
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function dataRouter() {
  const r = express.Router();
  const isTable = (t: string): t is DataTable => (DATA_TABLES as readonly string[]).includes(t);

  r.get('/events/:eventId/data/:table.csv', h((req, res) => {
    const ev = getEvent(String(req.params.eventId));
    if (!ev) throw notFound('Event not found.');
    requireRole(req, ev.id, 'admin');
    const table = String(req.params.table);
    if (!isTable(table)) throw notFound('Unknown table.');
    const { columns, rows } = loadTable(ev.id, table);
    const body = '﻿' + [columns.join(','), ...rows.map((row) => columns.map((c) => csvCell(row[c] ?? null)).join(','))].join('\r\n') + '\r\n';
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="wayve-${table}-${date}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(body);
  }));

  r.get('/events/:eventId/data/:table', h((req, res) => {
    const ev = getEvent(String(req.params.eventId));
    if (!ev) throw notFound('Event not found.');
    requireRole(req, ev.id, 'admin');
    const table = String(req.params.table);
    if (!isTable(table)) throw notFound('Unknown table.');
    const limit = Math.max(1, Math.min(1000, Number(req.query.limit) || 200));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const needle = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const { columns, rows } = loadTable(ev.id, table);
    const filtered = needle ? rows.filter((row) => Object.values(row).some((v) => typeof v === 'string' && v.toLowerCase().includes(needle))) : rows;
    const body: DataPage = { table, columns, rows: filtered.slice(offset, offset + limit), total: filtered.length };
    res.setHeader('Cache-Control', 'no-store');
    res.json(body);
  }));

  // organizer knowledge (run-of-show, FAQ, contacts) — the assistants read it
  r.get('/events/:eventId/knowledge', h((req, res) => {
    const ev = getEvent(String(req.params.eventId));
    if (!ev) throw notFound('Event not found.');
    requireRole(req, ev.id, 'staff');
    const text = getKnowledge(ev.id);
    const row = q.get<{ knowledge_updated_at: number | null }>('SELECT knowledge_updated_at FROM events WHERE id = ?', ev.id);
    const body: EventKnowledge = { text, updatedAt: row?.knowledge_updated_at ?? null };
    res.json(body);
  }));
  r.put('/events/:eventId/knowledge', express.json({ limit: '128kb' }), h((req, res) => {
    const ev = getEvent(String(req.params.eventId));
    if (!ev) throw notFound('Event not found.');
    requireRole(req, ev.id, 'admin');
    const b = parse(z.object({ text: z.string().max(20_000) }), req.body);
    q.run('UPDATE events SET knowledge = ?, knowledge_updated_at = ? WHERE id = ?', b.text.trim() || null, Date.now(), ev.id);
    res.json({ ok: true });
  }));

  void HttpErr;
  return r;
}
