// Staff assistant turn (chat or voice): a full read-only picture of the venue goes to the model; it answers and, for clear
// commands from the asker, proposes tracker actions that ops.applyAction applies (auto above the bar, else a suggestion).
import { venueLayout } from './layout.ts';
import { crewState } from './crew.ts';
import { zoneLine } from './zoneTrack.ts';
import {
  CROWD_LABEL, DEVICE_OFFLINE_MS, ISSUE_STATUS_LABEL, PRIORITY_LABEL, REPORT_CATEGORY_LABEL, REPORT_STATUS_LABEL, ZONE_STALE_MS,
  ZONE_STATUS_LABEL, type AssistantAction, type AssistantTurn, type Citation, type CrowdLevel, type IssueStatus, type Priority,
  type ReportCategory, type ZoneStatus,
} from '../shared/contracts.ts';
import { q, tx } from './db.ts';
import { transcribe } from './ai.ts';
import { assistantModel, speak } from './ai3.ts';
import {
  applyAction, evidenceRef, fmtHHMM, getIssueRow, insertUtterance, issueKey, listTeams, toUtterance,
  type IssueRow, type ModelAction, type UtteranceRow,
} from './ops.ts';
import { toReport, type ReportRow } from './reports.ts';
import { getEvent, getKnowledge, listZoneRows, primaryDevice, publishAll, type DeviceRow, type Frame, type ParticipantRow , toZone } from './world.ts';

const ago = (t: number | null, now: number) => {
  if (!t) return 'never';
  const s = Math.max(0, Math.round((now - t) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
};

function crewLines(eventId: string, now: number): string[] {
  const { crew, crewPosts } = crewState(eventId);
  if (!crew.length) return ['- none'];
  return crew.filter((a) => a.active).map((a) => {
    const posts = crewPosts.filter((p) => p.agentId === a.id).slice(0, 2).map((p) => `"${p.text}" (${ago(p.at, now)})`).join('; ');
    return `- ${a.name} (${a.role.replace('_', ' ')}, ${a.status})${posts ? `: ${posts}` : ''}`;
  });
}

function knowledgeText(eventId: string): string {
  try { return getKnowledge(eventId).trim(); } catch { return ''; }
}

/** Read-only text view of everything happening at the event, from the asker's point of view. U-refs → utterances. */
export function buildContext(asker: ParticipantRow, question: string): { text: string; refs: Map<string, UtteranceRow> } {
  const now = Date.now();
  const eventId = asker.event_id;
  const ev = getEvent(eventId)!;
  const teams = listTeams(eventId);
  const zones = listZoneRows(eventId);
  const tname = (id: string | null | undefined) => (id ? teams.find((t) => t.id === id)?.name ?? '' : '');
  const zname = (id: string | null | undefined) => (id ? zones.find((z) => z.id === id)?.name ?? '' : '');
  const people = q.all<ParticipantRow>(`SELECT * FROM participants WHERE event_id = ? AND role IN ('staff','admin') ORDER BY created_at`, eventId);
  const pname = (id: string | null) => (id ? people.find((p) => p.id === id)?.display_name ?? '' : '');
  const myDevice = primaryDevice(asker.id);

  const issues = q.all<IssueRow>(`SELECT * FROM issues WHERE event_id = ? AND (status != 'done' OR updated_at >= ?) ORDER BY updated_at DESC LIMIT 80`, eventId, now - 3600_000);
  const mine = issues.filter((i) => i.assignee_id === asker.id && i.status !== 'done');
  const issueLine = (i: IssueRow) => {
    const last = q.get<{ ref_type: 'utterance' | 'observation'; ref_id: string }>('SELECT ref_type, ref_id FROM issue_evidence WHERE issue_id = ? ORDER BY at DESC LIMIT 1', i.id);
    const ev0 = last ? evidenceRef({ type: last.ref_type, id: last.ref_id }) : null;
    return `- ${issueKey(i.number)} [${ISSUE_STATUS_LABEL[i.status as IssueStatus]} · ${PRIORITY_LABEL[i.priority as Priority]}] ${i.title}`
      + ` · owner ${pname(i.assignee_id) || (i.assignee_hint ? `unassigned (mentioned ${i.assignee_hint})` : 'unassigned')}`
      + `${i.team_id ? ` · team ${tname(i.team_id)}` : ''}${i.zone_id ? ` · at ${zname(i.zone_id)}` : ''}${i.due_at ? ` · due ${fmtHHMM(i.due_at)}` : ''}`
      + ` · updated ${ago(i.updated_at, now)}${i.escalated ? ' · ESCALATED to HQ' : ''}${ev0 ? ` · last: "${ev0.text.slice(0, 90)}" (${ev0.speaker ?? ev0.source})` : ''}`;
  };

  const tokens = [...new Set(question.toLowerCase().replace(/[?.!,]/g, ' ').split(/\s+/).filter((w) => w.length >= 3))];
  const recent = q.all<UtteranceRow>('SELECT * FROM utterances WHERE event_id = ? AND started_at >= ? ORDER BY started_at DESC LIMIT 300', eventId, now - 40 * 60_000);
  const relevant = recent.filter((u) => tokens.some((t) => u.text.toLowerCase().includes(t) || u.speaker.toLowerCase().includes(t)));
  const picked = [...new Map([...relevant.slice(0, 25), ...recent.slice(0, 40)].map((u) => [u.id, u])).values()].sort((a, b) => a.started_at - b.started_at).slice(-55);
  const refs = new Map<string, UtteranceRow>();
  picked.forEach((u, i) => refs.set(`U${i + 1}`, u));

  let reports: string[] = [];
  try {
    reports = q.all<ReportRow>('SELECT * FROM reports WHERE event_id = ? ORDER BY created_at DESC LIMIT 15', eventId).map((r) => {
      const rp = toReport(r);
      return `- ${fmtHHMM(rp.createdAt)} ${rp.authorName}: ${rp.ai?.title ?? rp.text ?? rp.transcript ?? REPORT_CATEGORY_LABEL[rp.category as ReportCategory]}`
        + `${rp.zoneId ? ` · at ${zname(rp.zoneId)}` : ''} · ${rp.urgency} · ${REPORT_STATUS_LABEL[rp.status]}${rp.issueKey ? ` · ${rp.issueKey}` : ''}`;
    });
  } catch { /* reports table missing */ }

  const devices = q.all<DeviceRow & { position?: string | null }>('SELECT * FROM devices WHERE event_id = ? ORDER BY created_at', eventId);
  const deviceLines = devices.filter((d) => d.device_type !== 'reporter').map((d) => {
    const regions = d.regions_json ? (JSON.parse(d.regions_json) as Array<{ zoneId: string }>).map((r) => zname(r.zoneId)).filter(Boolean) : [];
    const online = now - d.last_seen_at < DEVICE_OFFLINE_MS;
    const pos = (d as { position?: unknown }).position;
    const posText = typeof pos === 'string' && pos ? ` · position ${pos.slice(0, 60)}` : '';
    return `- ${d.label} (${d.device_type}) at ${zname(d.zone_id) || 'no zone'}${regions.length ? ` · covers ${regions.join(' + ')}` : ''}${posText}`
      + ` · ${d.status} · last frame ${ago(d.last_frame_at, now)} · ${online ? 'online' : `OFFLINE since ${ago(d.last_seen_at, now)}`}`;
  });

  const unacked = q.all<{ id: string; from_id: string; text: string; created_at: number; expected_json: string }>(
    'SELECT * FROM messages WHERE event_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 40', eventId, now - 3 * 3600_000)
    .filter((m) => (JSON.parse(m.expected_json) as string[]).includes(asker.id)
      && !q.get('SELECT 1 FROM message_acks WHERE message_id = ? AND participant_id = ?', m.id, asker.id));

  const knowledge = knowledgeText(eventId);
  const lines = [
    `Event: ${ev.name} · now ${fmtHHMM(now)}`,
    `Asker: ${asker.display_name} (${asker.role}${asker.team_id ? `, team ${tname(asker.team_id)}` : ''}) · location: ${zname(myDevice?.zone_id) || 'unknown'}`,
    `Asker's open issues: ${mine.length ? mine.map((i) => `${issueKey(i.number)} ${i.title}`).join('; ') : 'none'}`,
    `Unacknowledged radio for the asker: ${unacked.length ? unacked.map((m) => `${fmtHHMM(m.created_at)} ${pname(m.from_id)}: "${m.text.slice(0, 80)}"`).join('; ') : 'none'}`,
    '',
    `Teams: ${teams.map((t) => `${t.name} (${people.filter((p) => p.team_id === t.id).map((p) => p.display_name).join(', ') || 'nobody'})`).join(' · ') || 'none'}`,
    `People without a team: ${people.filter((p) => !p.team_id).map((p) => p.display_name).join(', ') || 'none'}`,
    '',
    'ISSUES (open + updated in the last hour):',
    ...(issues.length ? issues.map(issueLine) : ['- none']),
    '',
    'ZONES:',
    ...(zones.length ? zones.map((z) => {
      // Tracked state (smoothed metrics, next action) when available; raw status otherwise.
      const w = toZone(z);
      if (w.track) return `${zoneLine(w, now)} · last observed ${ago(z.last_observed_at, now)}`;
      return `- ${z.name}: ${ZONE_STATUS_LABEL[z.current_status as ZoneStatus]}${z.crowd_level ? ` (${CROWD_LABEL[z.crowd_level as CrowdLevel]})` : ''}`
        + `${z.people_estimate != null ? ` · ~${z.people_estimate} people` : ''} · last observed ${ago(z.last_observed_at, now)}${z.last_observed_at && now - z.last_observed_at > ZONE_STALE_MS ? ' (STALE)' : ''}`;
    }) : ['- none']),
    '',
    'VENUE LAYOUT (floor plan):',
    ...(venueLayout(zones).length ? venueLayout(zones) : ['- unknown']),
    '',
    'CAMERAS & SCRIBES:',
    ...(deviceLines.length ? deviceLines : ['- none']),
    '',
    'AI CREW (personas and what they just did):',
    ...crewLines(eventId, now),
    '',
    'FIELD REPORTS (latest):',
    ...(reports.length ? reports : ['- none']),
    '',
    'TRANSCRIPTS (meetings + radio, last 40 min):',
    ...(picked.length ? [...refs].map(([r, u]) => `${r} [${fmtHHMM(u.started_at)}] ${u.speaker}${u.team_id ? ` (${tname(u.team_id)})` : ''} · ${u.source}: ${u.text}`) : ['- none']),
    '',
    'ORGANIZER KNOWLEDGE (run-of-show, FAQ, contacts):',
    knowledge ? knowledge.slice(0, 12_000) : '- none provided',
  ];
  return { text: lines.join('\n'), refs };
}

function actionSummary(a: ModelAction, key: string | null): string {
  if (a.type === 'create') return `New ${a.kind ?? 'task'}: ${a.title ?? ''}${a.assignee ? ` · ${a.assignee}` : ''}`.trim();
  if (a.type === 'decision') return `Decision: ${a.title ?? ''}`;
  const parts = [
    a.status ? `→ ${ISSUE_STATUS_LABEL[a.status]}` : null, a.assignee ? `owner ${a.assignee}` : null,
    a.priority ? `priority ${PRIORITY_LABEL[a.priority]}` : null, a.due ? `due ${a.due}` : null,
  ].filter(Boolean);
  return `${key ?? (a.issueNumber != null ? `WV-${a.issueNumber}` : 'Issue')} ${parts.join(' · ') || 'updated'}`;
}

export async function assistantTurn(asker: ParticipantRow, inp: {
  text: string | null; audio: { mime: string; buf: Buffer } | null; speak: boolean; images?: Array<{ mime: string; buf: Buffer }>;
}): Promise<AssistantTurn> {
  const images = (inp.images ?? []).slice(0, 4);
  const eventId = asker.event_id;
  let transcript: string | null = null;
  if (inp.audio) {
    const vocab = [...listTeams(eventId).map((t) => t.name), ...listZoneRows(eventId).map((z) => z.name),
      ...q.all<{ display_name: string }>(`SELECT display_name FROM participants WHERE event_id = ? AND role IN ('staff','admin')`, eventId).map((p) => p.display_name)];
    const tr = await transcribe(inp.audio.buf, inp.audio.mime, vocab.slice(0, 40));
    transcript = tr.text.trim() || null;
  }
  const said = (transcript ?? inp.text ?? '').trim() || (images.length ? `(sent ${images.length === 1 ? 'a photo' : `${images.length} photos`})` : '');
  if (!said) return { transcript, answer: "I didn't catch that. Could you say it again?", model: '', citations: [], actions: [], speech: null, focus: { zoneIds: [], issueIds: [], deviceIds: [] } };

  const ctx = buildContext(asker, said);
  const out = await assistantModel(said, asker.display_name, ctx.text, inp.speak, images);

  // Actions: record the words as an utterance (evidence), then let the rules apply each proposal.
  const actions: AssistantAction[] = [];
  if (out.actions.length) {
    const now = Date.now();
    const dev = primaryDevice(asker.id);
    const frames: Frame[] = tx(() => {
      const u = insertUtterance({
        event_id: eventId, team_id: asker.team_id ?? null, device_id: dev?.id ?? asker.id, participant_id: asker.id, speaker: asker.display_name,
        source: 'talk', text: said.slice(0, 2000), started_at: now, ended_at: now, model: out.model, latency_ms: null,
      });
      const all: Frame[] = [];
      for (const a of out.actions) {
        const ma: ModelAction = { ...a, evidence: [] };
        const f = applyAction(eventId, ma, [{ type: 'utterance', id: u.id }], a.confidence, asker, 'talk', asker.team_id ?? null, now);
        const issueFrame = f.find((x) => x[0] === 'issue');
        const key = issueFrame ? (issueFrame[1] as { key: string }).key : (a.issueNumber != null ? `WV-${a.issueNumber}` : null);
        actions.push({ summary: actionSummary(ma, key), issueKey: key, applied: !f.some((x) => x[0] === 'proposal') && f.length > 0 });
        all.push(...f);
      }
      all.push(['utterance', toUtterance(q.get<UtteranceRow>('SELECT * FROM utterances WHERE id = ?', u.id)!)]);
      return all;
    });
    publishAll(eventId, frames);
  }

  const citations: Citation[] = [];
  for (const n of out.issues) {
    const i = q.get<IssueRow>('SELECT * FROM issues WHERE event_id = ? AND number = ?', eventId, n);
    if (i) citations.push({ type: 'issue', id: i.id, label: issueKey(i.number), text: getIssueRow(i.id)!.title, at: null });
  }
  for (const ref of out.lines) {
    const u = ctx.refs.get(ref);
    if (u) citations.push({ type: 'utterance', id: u.id, label: u.speaker, text: u.text, at: u.started_at });
  }

  // Inline focus: zones / issues / devices the answer is about (deterministic name matching).
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9가-힣]+/g, '');
  const zoneRows = listZoneRows(eventId);
  const zoneIds = [...new Set(out.zones.map((n) => {
    const k = norm(n);
    return (zoneRows.find((z) => norm(z.name) === k) ?? zoneRows.find((z) => k.length >= 3 && (norm(z.name).includes(k) || k.includes(norm(z.name)))))?.id;
  }).filter((x): x is string => !!x))];
  const devRows = q.all<{ id: string; label: string; zone_id: string | null }>('SELECT id, label, zone_id FROM devices WHERE event_id = ?', eventId);
  const deviceIds = [...new Set(out.devices.map((n) => devRows.find((d) => norm(d.label) === norm(n))?.id).filter((x): x is string => !!x))];
  const issueIds = citations.filter((c) => c.type === 'issue').map((c) => c.id);
  for (const a of actions) {
    if (!a.issueKey) continue;
    const m = /^WV-(\d+)$/.exec(a.issueKey);
    const row = m ? q.get<IssueRow>('SELECT * FROM issues WHERE event_id = ? AND number = ?', eventId, Number(m[1])) : undefined;
    if (row && !issueIds.includes(row.id)) issueIds.push(row.id);
  }
  // Issues pinned to zones pull those zones into focus too (so the map shows where they are).
  for (const id of issueIds) {
    const z = getIssueRow(id)?.zone_id;
    if (z && !zoneIds.includes(z)) zoneIds.push(z);
  }
  const focus = { zoneIds: zoneIds.slice(0, 12), issueIds: issueIds.slice(0, 8), deviceIds: deviceIds.slice(0, 8) };

  let speech: string | null = null;
  if (inp.speak && out.answer) {
    try { speech = `data:audio/mpeg;base64,${(await speak(out.answer)).toString('base64')}`; } catch { speech = null; }
  }
  return { transcript, answer: out.answer, model: out.model, citations, actions, speech, focus };
}
