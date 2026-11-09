// Field reports (v3): photo / voice / text + category + urgency + location → AI summary → observation (zone state) →
// deterministic issue linking (same spot → same issue) → live frames. Report status follows its issue.
import {
  REPORT_CATEGORY_LABEL, type Issue, type Modality, type Priority, type Report, type ReportCategory, type ReportStatus,
  type ReportsState, type Urgency,
} from '../shared/contracts.ts';
import { q, tx } from './db.ts';
import { aiInfo, transcribe } from './ai.ts';
import { structureFieldReport, type ReportAi } from './ai3.ts';
import { log } from './log.ts';
import { mediaUrl, saveMedia } from './media.ts';
import { changeIssue, createIssue, getIssueRow, issueKey, mirrorIncident, toIssue, type Actor, type IssueRow } from './ops.ts';
import { applyObservation } from './rules.ts';
import {
  getEvent, getZoneRow, listZoneRows, newId, primaryDevice, publishAll, type DeviceRow, type Frame, type ParticipantRow, type ZoneRow,
} from './world.ts';

export type ReportRow = {
  id: string; event_id: string; author_id: string; zone_id: string | null; category: string; urgency: string; text: string | null;
  transcript: string | null; photo_path: string | null; ai_json: string | null; issue_id: string | null; observation_id: string | null;
  parent_report_id: string | null; created_at: number;
};

const STATUS_OF: Record<string, ReportStatus> = { open: 'received', in_progress: 'reviewing', blocked: 'reviewing', done: 'resolved' };

export function toReport(r: ReportRow): Report {
  const author = q.get<{ display_name: string }>('SELECT display_name FROM participants WHERE id = ?', r.author_id)?.display_name ?? 'Unknown';
  const issue = r.issue_id ? getIssueRow(r.issue_id) : undefined;
  const status: ReportStatus = issue ? STATUS_OF[issue.status] ?? 'received' : 'received';
  let reviewing: number | null = null;
  let resolved: number | null = null;
  if (issue) {
    const ev = q.all<{ to_raw: string | null; at: number }>(
      `SELECT to_raw, at FROM issue_events WHERE issue_id = ? AND field = 'status' AND undone = 0 AND at >= ? ORDER BY id`, issue.id, r.created_at);
    reviewing = ev.find((e) => e.to_raw === 'in_progress' || e.to_raw === 'blocked')?.at ?? null;
    if (issue.status === 'done') resolved = [...ev].reverse().find((e) => e.to_raw === 'done')?.at ?? issue.updated_at;
    if (resolved && !reviewing) reviewing = resolved;
  }
  const linked = r.issue_id ? (q.get<{ n: number }>('SELECT COUNT(*) AS n FROM reports WHERE issue_id = ?', r.issue_id)?.n ?? 1) : 1;
  return {
    id: r.id, eventId: r.event_id, authorId: r.author_id, authorName: author, zoneId: r.zone_id, category: r.category as ReportCategory,
    urgency: r.urgency as Urgency, text: r.text, transcript: r.transcript, photoUrl: mediaUrl(r.photo_path), ai: r.ai_json ? JSON.parse(r.ai_json) : null,
    issueId: r.issue_id, issueKey: issue ? issueKey(issue.number) : null, issueTitle: issue?.title ?? null, linkedReports: linked, status,
    statusAt: { received: r.created_at, reviewing, resolved }, parentReportId: r.parent_report_id, createdAt: r.created_at,
  };
}

export function reportsState(eventId: string): ReportsState {
  try {
    return { reports: q.all<ReportRow>('SELECT * FROM reports WHERE event_id = ? ORDER BY created_at DESC LIMIT 100', eventId).map(toReport) };
  } catch {
    return { reports: [] }; // table not migrated yet
  }
}

export const getReportRow = (id: string) => q.get<ReportRow>('SELECT * FROM reports WHERE id = ?', id);

/** Reports whose display (status / linked count) depends on this issue. Call after an issue changes to refresh clients. */
export function reportFramesForIssue(issueId: string): Frame[] {
  return q.all<ReportRow>('SELECT * FROM reports WHERE issue_id = ? ORDER BY created_at DESC LIMIT 20', issueId).map((r) => ['report', toReport(r)] as Frame);
}

// ── deterministic linking helpers ───────────────────────────────────────────────────────────────────────────────────

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
function dice(a: string, b: string): number {
  const bg = (s: string) => { const t = norm(s); const o: string[] = []; for (let i = 0; i < t.length - 1; i++) o.push(t.slice(i, i + 2)); return o; };
  const A = bg(a), B = bg(b);
  if (!A.length || !B.length) return norm(a) === norm(b) ? 1 : 0;
  const pool = [...B];
  let hit = 0;
  for (const x of A) { const i = pool.indexOf(x); if (i >= 0) { hit++; pool.splice(i, 1); } }
  return (2 * hit) / (A.length + B.length);
}

const LINK_WINDOW_MS = 30 * 60_000;

function findIssueToJoin(eventId: string, zoneId: string | null, category: ReportCategory, title: string, now: number): IssueRow | null {
  // 1) same zone + same category, recent, still open
  if (zoneId) {
    const row = q.get<{ issue_id: string }>(
      `SELECT r.issue_id FROM reports r JOIN issues i ON i.id = r.issue_id
       WHERE r.event_id = ? AND r.zone_id = ? AND r.category = ? AND r.created_at >= ? AND i.status != 'done'
       ORDER BY r.created_at DESC LIMIT 1`, eventId, zoneId, category, now - LINK_WINDOW_MS);
    if (row) return getIssueRow(row.issue_id) ?? null;
  }
  // 2) an open issue at the same spot with a similar title (incl. camera/meeting-born issues)
  const open = q.all<IssueRow>(
    `SELECT * FROM issues WHERE event_id = ? AND status != 'done' AND ${zoneId ? 'zone_id = ?' : 'zone_id IS NULL AND created_at >= ?'} ORDER BY updated_at DESC LIMIT 60`,
    eventId, zoneId ?? now - LINK_WINDOW_MS);
  let best: IssueRow | null = null, bestScore = 0;
  for (const i of open) { const s = dice(i.title, title); if (s > bestScore) { best = i; bestScore = s; } }
  return bestScore >= 0.5 ? best : null;
}

function priorityFor(urgency: Urgency, category: ReportCategory): Priority {
  if (urgency === 'urgent') return category === 'safety' || category === 'medical' ? 'p0' : 'p1';
  return urgency === 'caution' ? 'p2' : 'p3';
}

function matchZoneName(eventId: string, hint: string | null): ZoneRow | null {
  if (!hint) return null;
  const n = norm(hint);
  if (!n) return null;
  const zones = listZoneRows(eventId);
  return zones.find((z) => norm(z.name) === n) ?? zones.find((z) => { const zn = norm(z.name); return zn.length >= 2 && (zn.includes(n) || n.includes(zn)); }) ?? null;
}

// ── pipeline ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CreateReportInput {
  participant: ParticipantRow;
  zoneId: string | null;
  category: ReportCategory;
  urgency: Urgency;
  text: string | null;
  photo: { mime: string; buf: Buffer } | null;
  audio: { mime: string; buf: Buffer } | null;
  parentReportId: string | null;
}

export class ReportError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}

export async function createReport(inp: CreateReportInput): Promise<{ report: Report; issue: Issue | null }> {
  const p = inp.participant;
  const eventId = p.event_id;
  const ev = getEvent(eventId)!;
  const zones = listZoneRows(eventId);
  const device = primaryDevice(p.id);
  const parent = inp.parentReportId ? q.get<ReportRow>('SELECT * FROM reports WHERE id = ? AND event_id = ?', inp.parentReportId, eventId) : undefined;
  if (inp.parentReportId && !parent) throw new ReportError(404, 'NOT_FOUND', 'The original report was not found.');
  let explicitZone = inp.zoneId ? getZoneRow(inp.zoneId) : undefined;
  if (explicitZone && explicitZone.event_id !== eventId) explicitZone = undefined;
  const fallbackZone = explicitZone ?? (parent?.zone_id ? getZoneRow(parent.zone_id) : undefined) ?? (device?.zone_id ? getZoneRow(device.zone_id) : undefined);

  // 1. Voice → text (audio is never stored).
  let transcript: string | null = null;
  if (inp.audio) {
    if (!aiInfo().enabled) throw new ReportError(503, 'AI_DISABLED', 'Voice notes need AI, which is off. Type the report instead.');
    const tr = await transcribe(inp.audio.buf, inp.audio.mime, zones.map((z) => z.name));
    transcript = tr.text.trim() || null;
  }
  if (!inp.text && !transcript && !inp.photo) throw new ReportError(400, 'EMPTY', "We couldn't hear anything. Add a note or a photo.");

  // 2. AI summary (best effort — a report is never lost because the AI failed).
  let ai: (ReportAi & { model: string }) | null = null;
  if (aiInfo().enabled) {
    try {
      const r = await structureFieldReport({
        text: inp.text, transcript, photo: inp.photo, category: REPORT_CATEGORY_LABEL[inp.category], urgency: inp.urgency,
        zoneName: fallbackZone?.name ?? null, zones: zones.map((z) => z.name),
      });
      ai = { ...r.ai, model: r.model };
    } catch (e) {
      log.warn('reports.ai_failed', { err: (e as Error).message });
    }
  }
  const zone = explicitZone ?? matchZoneName(eventId, ai?.zone_hint ?? null) ?? fallbackZone ?? null;
  const words = (inp.text || transcript || '').trim();
  const title = (ai?.title || (words ? words.split(/[.!?\n]/)[0].slice(0, 60) : `${REPORT_CATEGORY_LABEL[inp.category]} report${zone ? ` · ${zone.name}` : ''}`)).trim();

  // 3. Photo is kept (staff took it on purpose for this report).
  const photoPath = inp.photo ? saveMedia('reports', inp.photo.buf, inp.photo.mime) : null;

  const now = Date.now();
  const actor: Actor = { kind: 'human', id: p.id, name: p.display_name };
  const out = tx(() => {
    const frames: Frame[] = [];
    let observationId: string | null = null;
    let incidentId: string | null = null;
    // 4. Observation → zone state. issue_type 'none': this report's issue is handled below, not by the incident rules.
    if (zone) {
      const dev: DeviceRow = device ?? {
        id: p.id, event_id: eventId, participant_id: p.id, zone_id: zone.id, device_type: 'reporter', status: 'idle', label: p.display_name,
        last_seen_at: now, last_frame_at: null, last_error: null, created_at: p.created_at,
      };
      const modality: Modality = inp.photo ? 'vision' : inp.audio ? 'voice' : 'text';
      const r = applyObservation({
        eventId, zone, device: dev, participant: p, modality, now,
        payload: {
          kind: 'report', transcript: [inp.text, transcript].filter(Boolean).join(' / ').slice(0, 1200), issue_type: 'none',
          crowd_level: ai?.crowd_level ?? null, summary: ai?.summary ?? title, zone_hint: ai?.zone_hint ?? null, confidence: ai?.confidence ?? 1,
        },
        confidence: ai?.confidence ?? 1, model: ai?.model ?? null, latencyMs: null,
      });
      observationId = r.observationId;
      frames.push(...r.frames);
      // A "packed" crowd reading can still open an incident through the rules — keep it tied to this report's issue.
      incidentId = r.incidents[0]?.id ?? null;
    }
    const evidence = observationId ? [{ type: 'observation' as const, id: observationId }] : [];

    // 5. Same spot → same issue. Otherwise a new problem issue owned by the reporter's report.
    let issueId: string | null = parent?.issue_id ?? findIssueToJoin(eventId, zone?.id ?? null, inp.category, title, now)?.id ?? null;
    if (issueId && getIssueRow(issueId)) {
      const cur = getIssueRow(issueId)!;
      const want = priorityFor(inp.urgency, inp.category);
      const ch = want < cur.priority ? { priority: want } : {}; // 'p0' < 'p1' … raise, never lower
      frames.push(...changeIssue(issueId, ch, actor, evidence, null, now));
      if (incidentId && !cur.incident_id) q.run('UPDATE issues SET incident_id = ? WHERE id = ?', incidentId, issueId);
    } else {
      const c = createIssue({
        eventId, title, kind: 'problem', priority: priorityFor(inp.urgency, inp.category), teamId: null, assigneeId: null, assigneeHint: null,
        dueAt: null, zoneId: zone?.id ?? null, incidentId, actor, evidence, confidence: null, now,
      });
      issueId = c.issue.id;
      frames.push(...c.frames);
    }
    if (incidentId) {
      // mirrorIncident would open a second issue for the same thing; the link above already ties them together.
      void mirrorIncident;
    }

    const id = newId('rp');
    q.run(`INSERT INTO reports (id, event_id, author_id, zone_id, category, urgency, text, transcript, photo_path, ai_json, issue_id, observation_id, parent_report_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, eventId, p.id, zone?.id ?? null, inp.category, inp.urgency, inp.text, transcript, photoPath,
      ai ? JSON.stringify({ title: ai.title, location: ai.location, situation: ai.situation, summary: ai.summary, confidence: ai.confidence, model: ai.model }) : null,
      issueId, observationId, parent?.id ?? null, now);
    const report = toReport(getReportRow(id)!);
    frames.push(['report', report]);
    // Siblings now show a new linked count.
    for (const f of reportFramesForIssue(issueId!)) if ((f[1] as Report).id !== id) frames.push(f);
    return { report, issueId, frames };
  });
  publishAll(eventId, out.frames);
  void ev;
  return { report: out.report, issue: out.issueId ? toIssue(getIssueRow(out.issueId)!) : null };
}

export function listReports(eventId: string, authorId: string | null): Report[] {
  const rows = authorId
    ? q.all<ReportRow>('SELECT * FROM reports WHERE event_id = ? AND author_id = ? ORDER BY created_at DESC LIMIT 200', eventId, authorId)
    : q.all<ReportRow>('SELECT * FROM reports WHERE event_id = ? ORDER BY created_at DESC LIMIT 200', eventId);
  return rows.map(toReport);
}

export function reportDetail(id: string): { report: Report; issue: Issue | null; related: Report[] } | null {
  const r = getReportRow(id);
  if (!r) return null;
  const related = r.issue_id
    ? q.all<ReportRow>('SELECT * FROM reports WHERE issue_id = ? AND id != ? ORDER BY created_at DESC LIMIT 20', r.issue_id, r.id).map(toReport)
    : [];
  return { report: toReport(r), issue: r.issue_id && getIssueRow(r.issue_id) ? toIssue(getIssueRow(r.issue_id)!) : null, related };
}
