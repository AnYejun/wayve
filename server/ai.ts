// Model calls (server-side only; the key never leaves this process). Every output is schema-constrained (strict JSON schema)
// AND re-validated with zod. The model never touches the database: callers pass its output through server/rules.ts.
// No API key → AI is disabled and every caller returns AI_DISABLED, so the phones fall back to manual observations.
// Nothing here is ever mocked: a failure is reported as a failure.
import OpenAI, { toFile } from 'openai';
import { z } from 'zod';
import {
  CROWD_LEVELS, HAZARD_TYPES, INCIDENT_TYPES, type AiInfo, type ReportPayload, type VisionPayload,
} from '../shared/contracts.ts';
import { config } from './config.ts';
import { log } from './log.ts';

export class AiError extends Error {
  code: 'AI_DISABLED' | 'AI_BUSY' | 'AI_FAILED' | 'AI_TIMEOUT';
  constructor(code: AiError['code'], message: string) { super(message); this.code = code; this.name = 'AiError'; }
}

export const client = config.OPENAI_API_KEY ? new OpenAI({ apiKey: config.OPENAI_API_KEY, maxRetries: 0 }) : null;

export const aiInfo = (): AiInfo => ({
  enabled: !!client,
  visionModel: client ? config.OPENAI_VISION_MODEL : null,
  textModel: client ? config.OPENAI_TEXT_MODEL : null,
  transcribe: !!client,
});

// ── concurrency + reasoning-param compatibility ─────────────────────────────────────────────────────────────────────

let inflight = 0;
export async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (!client) throw new AiError('AI_DISABLED', 'AI is turned off.');
  if (inflight >= config.AI_MAX_CONCURRENCY) throw new AiError('AI_BUSY', 'AI is busy. Retrying shortly.');
  inflight++;
  try { return await fn(); } finally { inflight--; }
}

/** Models that rejected the `reasoning` parameter (we then omit it). */
const noReasoning = new Set<string>();

type Content = Array<{ type: 'input_text'; text: string } | { type: 'input_image'; image_url: string; detail: 'low' | 'high' | 'auto' }>;

export async function respond(opts: {
  model: string; instructions: string; content: Content; schema?: { name: string; schema: Record<string, unknown> };
  maxOutputTokens: number; timeoutMs: number;
}): Promise<{ text: string; latencyMs: number }> {
  return limited(async () => {
    const t0 = performance.now();
    const call = async (withReasoning: boolean) => client!.responses.create({
      model: opts.model,
      instructions: opts.instructions,
      input: [{ role: 'user', content: opts.content }],
      ...(opts.schema ? { text: { format: { type: 'json_schema' as const, name: opts.schema.name, schema: opts.schema.schema, strict: true } } } : {}),
      max_output_tokens: opts.maxOutputTokens,
      store: false,
      ...(withReasoning && config.OPENAI_REASONING_EFFORT ? { reasoning: { effort: config.OPENAI_REASONING_EFFORT as 'low' } } : {}),
    }, { timeout: opts.timeoutMs });
    let resp;
    try {
      resp = await call(!noReasoning.has(opts.model));
    } catch (e) {
      const err = e as { status?: number; message?: string; param?: string };
      if (err.status === 400 && /reasoning/i.test(`${err.param ?? ''} ${err.message ?? ''}`) && !noReasoning.has(opts.model)) {
        noReasoning.add(opts.model);
        log.warn('ai.reasoning_param_rejected', { model: opts.model });
        resp = await call(false);
      } else {
        throw e;
      }
    }
    const text = resp.output_text ?? '';
    if (!text) throw new AiError('AI_FAILED', 'The model returned an empty response.');
    return { text, latencyMs: Math.round(performance.now() - t0) };
  }).catch((e) => {
    if (e instanceof AiError) throw e;
    const err = e as { status?: number; name?: string; message?: string };
    const timeout = err.name === 'APIConnectionTimeoutError' || /timed? ?out/i.test(err.message ?? '');
    log.error('ai.call_failed', { model: opts.model, status: err.status, name: err.name, msg: String(err.message ?? '').slice(0, 200) });
    throw new AiError(timeout ? 'AI_TIMEOUT' : 'AI_FAILED', timeout ? 'The AI took too long to respond.' : 'The AI request failed.');
  });
}

export const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

/** The language to answer in, decided in code (models drift toward Korean from names or venue context): Korean when at
 *  least a fifth of the letters are Hangul (Korean with English terms mixed in stays Korean), else English. */
export function replyLanguage(text: string): 'Korean' | 'English' {
  const letters = (text.match(/[A-Za-z\u3131-\u318E\uAC00-\uD7A3]/g) ?? []).length;
  const hangul = (text.match(/[\u3131-\u318E\uAC00-\uD7A3]/g) ?? []).length;
  return letters && hangul / letters >= 0.2 ? 'Korean' : 'English';
}
const LANG_NOTE = (lang: 'Korean' | 'English') => (lang === 'Korean' ? 'natural, polite Korean (해요체)' : 'English');

// ── Vision: one frame → VisionPayload ───────────────────────────────────────────────────────────────────────────────

const VISION_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['scene_ok', 'people_count', 'crowd_level', 'queue_present', 'hazards', 'summary', 'confidence'],
  properties: {
    scene_ok: { type: 'boolean', description: 'false if the frame is too dark, blurred or covered to judge' },
    people_count: { type: 'integer', description: 'approximate number of people visible' },
    crowd_level: { type: 'string', enum: [...CROWD_LEVELS] },
    queue_present: { type: 'boolean', description: 'a visible queue / line of people waiting' },
    hazards: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['type', 'confidence', 'detail'],
        properties: {
          type: { type: 'string', enum: [...HAZARD_TYPES] },
          confidence: { type: 'number', description: '0..1 calibrated' },
          detail: { type: 'string', description: 'English, under 40 characters, what and where in the frame' },
        },
      },
    },
    summary: { type: 'string', description: 'one short factual English sentence about the scene' },
    confidence: { type: 'number', description: '0..1 certainty of the crowd assessment' },
  },
} as const;

const VisionZ = z.object({
  scene_ok: z.boolean(),
  people_count: z.number(),
  crowd_level: z.enum(CROWD_LEVELS),
  queue_present: z.boolean(),
  hazards: z.array(z.object({ type: z.enum(HAZARD_TYPES), confidence: z.number(), detail: z.string() })).max(8),
  summary: z.string(),
  confidence: z.number(),
});

const VISION_INSTRUCTIONS = `You are WAYVE, a safety observer for a live event venue. You receive one frame from a smartphone camera that a staff member points at a zone.
Report ONLY what is visible in this frame. Never guess about things outside it. Never identify people.
- people_count: approximate count of people visible (0 if none).
- crowd_level, relative to the visible floor area: empty = nobody; low = a few people, free movement; moderate = steady flow with gaps; high = dense, movement slowed; critical = packed, bodies pressed together, no free space.
- hazards: list only clearly visible hazards with calibrated confidence; detail in English. fire_smoke = flames or smoke; spill = liquid on the floor; obstruction = object blocking a walkway or exit; fall_injury = a person lying on the floor; fight = people physically fighting; medical = someone visibly in distress; crowd_crush = dangerous compression; suspicious_item = unattended bag or object; other = any other clear safety issue. Empty array if none.
- summary: one short factual English sentence (e.g. "6 people around the tables, walkway clear").
- scene_ok: false when the image is too dark, blurred or covered to judge; then use crowd_level "empty", people_count 0, hazards [] and low confidence.
- confidence: your certainty about crowd_level and people_count, 0..1.`;

export async function analyzeFrame(image: Buffer, mime: string, zoneName: string): Promise<{ payload: VisionPayload; model: string; latencyMs: number }> {
  const model = config.OPENAI_VISION_MODEL;
  const dataUrl = `data:${mime};base64,${image.toString('base64')}`;
  const { text, latencyMs } = await respond({
    model,
    instructions: VISION_INSTRUCTIONS,
    content: [
      { type: 'input_text', text: `Zone: ${zoneName}` },
      { type: 'input_image', image_url: dataUrl, detail: 'low' },
    ],
    schema: { name: 'vision_observation', schema: VISION_SCHEMA },
    maxOutputTokens: 600,
    timeoutMs: config.VISION_TIMEOUT_MS,
  });
  const parsed = VisionZ.safeParse(safeJson(text));
  if (!parsed.success) { log.warn('ai.vision_schema_invalid', { model }); throw new AiError('AI_FAILED', 'The AI response was malformed.'); }
  const v = parsed.data;
  return {
    model, latencyMs,
    payload: {
      kind: 'vision',
      scene_ok: v.scene_ok,
      people_count: Math.max(0, Math.min(5000, Math.round(v.people_count))),
      crowd_level: v.crowd_level,
      queue_present: v.queue_present,
      hazards: v.hazards.map((h) => ({ type: h.type, confidence: clamp01(h.confidence), detail: h.detail.slice(0, 80) })),
      summary: v.summary.slice(0, 140),
      confidence: clamp01(v.confidence),
    },
  };
}

// ── Reports: text (typed or transcribed) → ReportPayload ────────────────────────────────────────────────────────────

const REPORT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['issue_type', 'crowd_level', 'summary', 'zone_hint', 'confidence'],
  properties: {
    issue_type: { type: 'string', enum: [...INCIDENT_TYPES, 'none'] },
    crowd_level: { type: ['string', 'null'], enum: [...CROWD_LEVELS, null] },
    summary: { type: 'string', description: 'one short factual English sentence' },
    zone_hint: { type: ['string', 'null'], description: 'the zone from the list the report refers to, copied exactly from the list; map misspelled or misheard names (speech transcripts) to the closest-sounding zone; null if no zone is mentioned' },
    confidence: { type: 'number', description: '0..1 how clearly the report states the issue' },
  },
} as const;

const ReportZ = z.object({
  issue_type: z.enum([...INCIDENT_TYPES, 'none']),
  crowd_level: z.enum(CROWD_LEVELS).nullable(),
  summary: z.string(),
  zone_hint: z.string().nullable(),
  confidence: z.number(),
});

export async function structureReport(transcript: string, zoneNames: string[], currentZone: string | null): Promise<{ payload: ReportPayload; model: string; latencyMs: number }> {
  const model = config.OPENAI_TEXT_MODEL;
  const { text, latencyMs } = await respond({
    model,
    instructions: `You structure short field reports from event staff (English or Korean, possibly from speech recognition) into one observation. Classify only what the report states. Always write in English.
issue_type: overcrowding (too many people), fire_smoke, spill (liquid on floor), obstruction (blocked path/exit), medical (someone hurt, fainted, unwell), fight, suspicious_item, long_queue, other (a clear problem not listed), none (no problem, e.g. status update or small talk).
crowd_level: only if the report describes how crowded it is, else null.
zone_hint: if the report names a place, return the zone name from the list exactly. Reports may come from speech recognition, so map misheard or misspelled names to the closest-sounding zone (e.g. "main haul" → "Main hall", "레인홀" → "메인 홀"). null if no place is named.
summary: one short factual English sentence. confidence: 0..1.`,
    content: [{ type: 'input_text', text: `Zones: ${zoneNames.join(', ')}\nReporter's current zone: ${currentZone ?? 'unknown'}\nReport: """${transcript.slice(0, 1200)}"""` }],
    schema: { name: 'field_report', schema: REPORT_SCHEMA },
    maxOutputTokens: 400,
    timeoutMs: config.TEXT_TIMEOUT_MS,
  });
  const parsed = ReportZ.safeParse(safeJson(text));
  if (!parsed.success) { log.warn('ai.report_schema_invalid', { model }); throw new AiError('AI_FAILED', 'The AI response was malformed.'); }
  const r = parsed.data;
  return {
    model, latencyMs,
    payload: { kind: 'report', transcript: transcript.slice(0, 1200), issue_type: r.issue_type, crowd_level: r.crowd_level, summary: r.summary.slice(0, 140), zone_hint: r.zone_hint, confidence: clamp01(r.confidence) },
  };
}

// ── Speech-to-text (audio is transcribed in memory and discarded) ───────────────────────────────────────────────────

/** `vocabulary` = zone names, passed as a prompt so the speech model spells them right. */
/** Speech models fill silence with their own prompt (or stock phrases like "Thanks for watching"). Those come back as ''
 *  so a silent or accidental clip reads as "no speech" everywhere: assistant, radio, scribe and voice reports. */
const ECHO_MARKERS = /transcribe verbatim|keep each word in the language|common terms:|korean terms:|names and places:|event operations radio and meetings|일반\s*용어|한국어\s*용어|이름\s*및\s*장소|이벤트\s*운영\s*라디오|그대로\s*전사/i;
const SILENCE_PHRASES = [/^(thank you|thanks)( so much| very much)?( for watching)?[.!]*$/i, /thanks? for watching/i, /^(you|bye)[.!]*$/i,
  /시청(해)?\s*주셔서\s*감사/, /구독(과|이랑)?\s*좋아요/, /MBC\s*뉴스/, /^[\s.…·-]*$/];
export function cleanTranscript(raw: string, prompt: string): string {
  const t = raw.trim();
  if (!t || ECHO_MARKERS.test(t) || SILENCE_PHRASES.some((re) => re.test(t))) return '';
  // A partial echo: almost every word is straight from the prompt's vocabulary list ("Stage, Lounge A, Lounge B, …").
  const split = (s: string) => s.toLowerCase().split(/[\s,.;:!?()"'“”]+/).filter((w) => w.length > 1);
  const words = split(t);
  if (words.length >= 6) {
    const vocab = new Set(split(prompt));
    if (words.filter((w) => vocab.has(w)).length / words.length >= 0.85) return '';
  }
  // The glossary read back as a list (sometimes translated): most comma-separated pieces are exactly glossary terms.
  const norm = (s: string) => s.toLowerCase().replace(/[.!?。]+$/u, '').trim();
  const terms = new Set(prompt.split(/[,:().]/).map(norm).filter(Boolean));
  const pieces = t.split(/[,、·]/).map(norm).filter(Boolean);
  if (pieces.length >= 6 && pieces.filter((x) => terms.has(x)).length / pieces.length >= 0.5) return '';
  return t;
}

export async function transcribe(audio: Buffer, mime: string, vocabulary: string[] = []): Promise<{ text: string; model: string; latencyMs: number }> {
  const model = config.OPENAI_TRANSCRIBE_MODEL;
  const ext = /mp4|m4a|aac/.test(mime) ? 'mp4' : /mpeg|mp3/.test(mime) ? 'mp3' : /wav/.test(mime) ? 'wav' : /ogg/.test(mime) ? 'ogg' : 'webm';
  return limited(async () => {
    const t0 = performance.now();
    const file = await toFile(audio, `report.${ext}`, { type: mime.split(';')[0] });
    // Language is auto-detected (no `language` param): Korean, English and Korean–English code-switching are transcribed
    // verbatim in the language spoken. The prompt only biases spelling of names/places and states the expected languages.
    const prompt = `Event operations radio and meetings, in Korean, English, or a mix of both (transcribe verbatim, keep each word in the language spoken). Common terms: name badge, lanyard, wristband, registration, check-in, extension cord, power strip, Wi-Fi, mic, projector, queue, spill, first aid. Korean terms: 명찰, 목걸이, 손목밴드, 등록, 접수, 체크인, 연장선, 멀티탭, 와이파이, 마이크, 프로젝터, 대기줄, 쏟아짐, 응급, 무대, 계단석, 관객석, 라운지, 입구, 커피 코너, 스타트업 브랜치, 코엑스, 심사, 제출, 데모, 해커톤.${vocabulary.length ? ` Names and places: ${vocabulary.join(', ')}` : ''}`;
    const r = await client!.audio.transcriptions.create({ file, model, ...(prompt ? { prompt } : {}) }, { timeout: config.TEXT_TIMEOUT_MS });
    const text = cleanTranscript(r.text ?? '', prompt);
    if (!text && (r.text ?? '').trim()) log.info('ai.transcript_dropped', { chars: (r.text ?? '').trim().length });
    return { text, model, latencyMs: Math.round(performance.now() - t0) };
  }).catch((e) => {
    if (e instanceof AiError) throw e;
    log.error('ai.transcribe_failed', { model, status: (e as { status?: number }).status, msg: String((e as Error).message).slice(0, 200) });
    throw new AiError('AI_FAILED', "Couldn't transcribe the audio.");
  });
}

// ── Staff agent: proposed action steps for a new task (a proposal, never an action) ─────────────────────────────────

const STEPS_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['steps'],
  properties: { steps: { type: 'array', items: { type: 'string' } } },
} as const;

export async function suggestSteps(ctx: { typeLabel: string; zoneName: string; description: string; evidence: string[] }): Promise<{ steps: string[]; model: string }> {
  const model = config.OPENAI_TEXT_MODEL;
  const { text } = await respond({
    model,
    instructions: `You help one event staff member respond to an incident. Propose 2–3 concrete, safe action steps in plain English, each under 60 characters, imperative ("Put up a wet-floor sign").
These are suggestions, not orders. Never give medical diagnosis. For fire/smoke, medical, fight or suspicious items, the first step must be to call the on-site safety/medical team. Do not invent facts beyond the evidence.`,
    content: [{ type: 'input_text', text: `Incident: ${ctx.typeLabel}\nZone: ${ctx.zoneName}\nDescription: ${ctx.description}\nEvidence:\n- ${ctx.evidence.join('\n- ')}` }],
    schema: { name: 'task_steps', schema: STEPS_SCHEMA },
    maxOutputTokens: 300,
    timeoutMs: config.TEXT_TIMEOUT_MS,
  });
  const parsed = z.object({ steps: z.array(z.string()).min(1) }).safeParse(safeJson(text));
  if (!parsed.success) throw new AiError('AI_FAILED', 'The AI response was malformed.');
  return { steps: parsed.data.steps.slice(0, 3).map((s) => s.slice(0, 80)), model };
}

// ── Staff assistant: answers from a read-only text snapshot of the venue ────────────────────────────────────────────

export async function askAssistant(question: string, context: string): Promise<{ answer: string; model: string }> {
  const model = config.OPENAI_TEXT_MODEL;
  const { text } = await respond({
    model,
    instructions: `You are WAYVE's assistant for one staff member at a live event. Answer in the language of the question (Korean → natural, polite Korean; English → English), at most 4 short sentences.
Use ONLY the venue state below (it is current). If the answer is not in it, say you don't know. You cannot take actions; suggest what the person could do.`,
    content: [{ type: 'input_text', text: `${context}\n\nQuestion: ${question.slice(0, 500)}\n\nAnswer in ${LANG_NOTE(replyLanguage(question))}.` }],
    maxOutputTokens: 600,
    timeoutMs: config.TEXT_TIMEOUT_MS,
  });
  return { answer: text.trim().slice(0, 1200), model };
}

export function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

// ── Attendee chatbot: one call answers the visitor AND classifies whether the message is a field report ────────────

const ATTENDEE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['reply', 'intent', 'ticket_title', 'urgent', 'report'],
  properties: {
    reply: { type: 'string', description: "answer to the attendee in the language of their latest message (Korean → natural, polite Korean; English → English), at most 3 short sentences" },
    intent: { type: 'string', enum: ['question', 'request', 'problem', 'other'], description: 'question = wants information; request = asks staff to bring/do/fix something for them (supplies, help, a service); problem = reports an on-site situation (crowding, queue, spill, hazard, broken thing); other = small talk / feedback' },
    ticket_title: { type: 'string', description: 'for request/problem: a short imperative task title for staff, ≤ 60 chars, with the place if known (e.g. "Bring an extension cord to table 12 · Lounge B", "Restock cups at the Coffee Corner"); "" otherwise' },
    urgent: { type: 'boolean', description: 'true only for safety/medical emergencies or something blocking many people right now' },
    report: {
      type: 'object', additionalProperties: false,
      required: ['is_report', 'issue_type', 'crowd_level', 'summary', 'zone_hint', 'confidence'],
      properties: {
        is_report: { type: 'boolean', description: 'true if the attendee describes an on-site situation (crowding, queue, hazard, problem) staff should know about' },
        issue_type: { type: 'string', enum: [...INCIDENT_TYPES, 'none'] },
        crowd_level: { type: ['string', 'null'], enum: [...CROWD_LEVELS, null] },
        summary: { type: 'string', description: 'one short factual English sentence for the staff dashboard ("" if not a report)' },
        zone_hint: { type: ['string', 'null'], description: 'zone the situation is in, copied exactly from the zone list (map misspellings to the closest zone), else null' },
        confidence: { type: 'number', description: '0..1 how clearly the message states the situation' },
      },
    },
  },
} as const;

const AttendeeZ = z.object({
  reply: z.string(),
  intent: z.enum(['question', 'request', 'problem', 'other']),
  ticket_title: z.string(),
  urgent: z.boolean(),
  report: z.object({
    is_report: z.boolean(), issue_type: z.enum([...INCIDENT_TYPES, 'none']), crowd_level: z.enum(CROWD_LEVELS).nullable(),
    summary: z.string(), zone_hint: z.string().nullable(), confidence: z.number(),
  }),
});

export async function attendeeChat(message: string, history: Array<{ role: 'user' | 'assistant'; text: string }>, context: string): Promise<{
  reply: string; report: { isReport: boolean; payload: ReportPayload }; model: string; latencyMs: number;
  intent: 'question' | 'request' | 'problem' | 'other'; ticketTitle: string; urgent: boolean;
}> {
  const model = config.OPENAI_TEXT_MODEL;
  const convo = history.slice(-8).map((m) => `${m.role === 'user' ? 'Attendee' : 'Assistant'}: ${m.text}`).join('\n');
  const { text, latencyMs } = await respond({
    model,
    instructions: `You are the friendly event chatbot for attendees of a live event. Reply in the language of the attendee's latest message — Korean → natural, polite Korean (해요체); English → English; mixed → the main language — at most 3 short sentences, warm and concrete. Keep names as written (zones, Wi-Fi networks, the event name). ticket_title and report.summary are always English: they go to the staff dashboard.
Answer questions about the event itself (schedule, food, Wi-Fi, directions, rules, submission, judging, prizes, judges) from the event info below. For directions use the venue layout and the attendee's current location: say it simply ("Lounge A is the left one of the three lounges in the middle, next to Lounge B"). If something is not in the info, say you don't know and suggest asking a staff member — never guess times or passwords.
You know the CURRENT crowd level of each zone (below, updated live from staff cameras). Use it to answer questions like where it is less crowded. If a zone has no recent observation, say you don't have fresh information about it.
Never mention staff names, internal incidents, tasks or cameras' identities. Never invent facilities that are not in the zone list.
If the attendee describes a situation staff should know (crowding, long queue, spill, blocked path, someone hurt, smoke/fire, fight, suspicious item, other problem): set report.is_report = true, classify it, and thank them, saying the operations team has been told. If you cannot tell which zone, set zone_hint null and ask which zone in your reply (the attendee's current zone, if known, counts as the zone).
For emergencies (fire, someone collapsed, fight) also tell them to move to safety and alert the nearest staff member or call emergency services (112 / 119 in Korea).
REQUESTS: when the attendee asks staff to bring, fix or do something for them ("we need an extension cord at table 12", "can someone bring more cups?", "the Wi-Fi password please"), set intent "request", write ticket_title as a clear task for staff, and reply that you've sent it to the team and they'll see live updates right here in the chat. If it can be answered from the event info (e.g. Wi-Fi, schedule), answer it instead and use intent "question". If the place matters and is unknown, ask where in your reply.
Problems (situations) use intent "problem" with report filled as described above and a ticket_title too.
Questions, small talk or feedback that is not about an on-site situation: report.is_report = false, issue_type "none".`,
    content: [{ type: 'input_text', text: `${context}\n\nConversation so far:\n${convo || '(none)'}\n\nAttendee's new message: """${message.slice(0, 500)}"""\n\nWrite "reply" in ${LANG_NOTE(replyLanguage(message))}.` }],
    schema: { name: 'attendee_turn', schema: ATTENDEE_SCHEMA },
    maxOutputTokens: 1000,
    timeoutMs: config.TEXT_TIMEOUT_MS,
  });
  const parsed = AttendeeZ.safeParse(safeJson(text));
  if (!parsed.success) { log.warn('ai.attendee_schema_invalid', { model }); throw new AiError('AI_FAILED', 'The AI response was malformed.'); }
  const { reply, report, intent, ticket_title: ticketTitle, urgent } = parsed.data;
  return {
    model, latencyMs, intent, ticketTitle: ticketTitle.trim().slice(0, 80), urgent,
    reply: reply.trim().slice(0, 600),
    report: {
      isReport: report.is_report && (report.issue_type !== 'none' || report.crowd_level != null),
      payload: {
        kind: 'report', transcript: message.slice(0, 500), issue_type: report.issue_type, crowd_level: report.crowd_level,
        summary: report.summary.slice(0, 140), zone_hint: report.zone_hint, confidence: clamp01(report.confidence),
      },
    },
  };
}

// ── Ops: extract issue actions from transcript lines (proposals only — server/ops.ts applies them) ───────────────────

export interface ExtractInput {
  nowKst: string;
  teams: string[];
  people: Array<{ name: string; team: string | null }>;
  issues: Array<{ number: number; title: string; status: string; assignee: string; team: string | null; due: string | null }>;
  lines: Array<{ ref: string; speaker: string; source: string; isNew: boolean; text: string; time: string }>;
  channelTeam: string | null;
  /** Zone names of the venue map (so speech like "near the entrance" lands on the right zone). */
  zones?: string[];
  /** Persona instructions of the agent bound to this scribe (AI crew), if any. */
  persona?: string | null;
}

const ACTION_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['actions'],
  properties: {
    actions: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['type', 'issue_number', 'title', 'kind', 'priority', 'team', 'zone', 'assignee', 'due', 'status', 'note', 'evidence', 'confidence'],
        properties: {
          type: { type: 'string', enum: ['create', 'update', 'decision'] },
          issue_number: { type: ['integer', 'null'], description: 'for update: the WV number of an existing issue' },
          title: { type: ['string', 'null'], description: 'create/decision: short English imperative or noun phrase, ≤ 50 chars, e.g. "Print 200 more badges"' },
          kind: { type: ['string', 'null'], enum: ['task', 'problem', 'question', null] },
          priority: { type: ['string', 'null'], enum: ['p0', 'p1', 'p2', 'p3', null] },
          team: { type: ['string', 'null'], description: 'team name exactly from the list, or null' },
          zone: { type: ['string', 'null'], description: 'where it is happening: a zone name copied exactly from the zone list when the lines name or clearly imply a place ("near the entrance" → "Entrance"), else null' },
          assignee: { type: ['string', 'null'], description: 'person name exactly as in the people list when they match; otherwise the bare name heard (no Korean 아/야/씨/님 endings); null if nobody' },
          due: { type: ['string', 'null'], description: '"HH:MM" 24h if a time was stated, else null' },
          status: { type: ['string', 'null'], enum: ['open', 'in_progress', 'blocked', 'done', null] },
          note: { type: ['string', 'null'] },
          evidence: { type: 'array', items: { type: 'string' }, description: 'refs like "U3" of the NEW lines this action comes from' },
          confidence: { type: 'number', description: '0..1 how explicitly the lines state this action' },
        },
      },
    },
  },
} as const;

const ActionZ = z.object({
  actions: z.array(z.object({
    type: z.enum(['create', 'update', 'decision']), issue_number: z.number().int().nullable(), title: z.string().nullable(),
    kind: z.enum(['task', 'problem', 'question']).nullable(), priority: z.enum(['p0', 'p1', 'p2', 'p3']).nullable(), team: z.string().nullable(), zone: z.string().nullable(),
    assignee: z.string().nullable(), due: z.string().nullable(), status: z.enum(['open', 'in_progress', 'blocked', 'done']).nullable(),
    note: z.string().nullable(), evidence: z.array(z.string()), confidence: z.number(),
  })).max(8),
});

export async function extractActions(inp: ExtractInput): Promise<{ actions: Array<import('../shared/contracts.ts').ProposedAction & { evidence: string[]; confidence: number }>; model: string }> {
  const model = config.OPENAI_TEXT_MODEL;
  const ctx = [
    `Now (event local time, 24h): ${inp.nowKst}`,
    `This channel's team: ${inp.channelTeam ?? 'none'}`,
    ...(inp.persona ? [`Listener persona (set by the organizers): ${inp.persona.slice(0, 600)}`] : []),
    `Teams: ${inp.teams.join(', ') || 'none'}`,
    `Zones: ${(inp.zones ?? []).join(', ') || 'none'}`,
    'Korean speech may name places in Korean (무대 stage, 입구 entrance, 계단·계단석·관객석 seating/stairs, 라운지 lounge, 커피 coffee, 등록·접수 registration, 화장실 restrooms): map them to the zone list.',
    `People: ${inp.people.map((p) => `${p.name}${p.team ? ` (${p.team})` : ''}`).join(', ') || 'none'}`,
    'Open / recent issues:',
    ...(inp.issues.length ? inp.issues.map((i) => `- WV-${i.number} [${i.status}] ${i.title} · owner ${i.assignee}${i.team ? ` · ${i.team}` : ''}${i.due ? ` · due ${i.due}` : ''}`) : ['- none']),
    '',
    'Conversation (only lines marked NEW just came in):',
    ...inp.lines.map((l) => `${l.ref} ${l.isNew ? 'NEW ' : ''}[${l.time}] ${l.speaker}(${l.source}): ${l.text}`),
  ].join('\n');
  const { text } = await respond({
    model,
    instructions: `You turn live speech at an event-operations team (meeting transcripts and push-to-talk messages, in English or Korean, may contain speech-recognition errors) into issue-tracker actions. Write titles and notes in English.
Only act on what the NEW lines explicitly say; older lines are context. Most lines need NO action — return an empty list for chit-chat, thinking aloud, or vague talk.
- create: a concrete task someone should do ("please …", "can you …", "we need …", "~해 주세요", an assignment to a named person), a problem reported, or an open question needing an answer. kind task/problem/question.
- decision: an explicit agreement/decision ("let's go with …", "we decided …", "~로 하기로 했어요"). title = the decision.
- update: the lines clearly refer to an EXISTING issue in the list (same thing, even if worded differently): progress ("working on it", "하고 있어요" → in_progress), blocked ("can't because …", "we don't have …", "막혔어요" → blocked), finished ("done", "all set", "끝났어요" → done), a new assignee, a new time, a priority change. Prefer update over create when it is the same thing.
- assignee: who should do it. If the speaker volunteers ("I'll do it", "제가 할게요"), the assignee is the speaker's name. Use names from the people list when they match (ignore 아/야/씨/님 endings); otherwise give the bare name heard.
- priority: p0 only for safety emergencies or event-stopping problems; p1 urgent/time-critical within the hour; p3 nice-to-have; default p2.
- due: only if a time is stated, as 24h "HH:MM" in event local time ("by two PM" / "2시까지" → "14:00"; "in 30 minutes" → now + 30 min).
- confidence: 0.9+ when explicit and unambiguous, 0.6–0.8 when likely, below 0.6 when you are guessing. Never invent people, numbers or times.`,
    content: [{ type: 'input_text', text: ctx }],
    schema: { name: 'ops_actions', schema: ACTION_SCHEMA },
    maxOutputTokens: 900,
    timeoutMs: config.TEXT_TIMEOUT_MS + 5000,
  });
  const parsed = ActionZ.safeParse(safeJson(text));
  if (!parsed.success) { log.warn('ai.actions_schema_invalid', { model }); throw new AiError('AI_FAILED', 'The AI response was malformed.'); }
  return {
    model,
    actions: parsed.data.actions.map((a) => ({
      type: a.type, issueNumber: a.issue_number, title: a.title?.slice(0, 80) ?? null, kind: a.kind, priority: a.priority, team: a.team, zone: a.zone?.slice(0, 60) ?? null,
      assignee: a.assignee?.slice(0, 30) ?? null, due: a.due, status: a.status, note: a.note?.slice(0, 200) ?? null,
      evidence: a.evidence.slice(0, 6), confidence: clamp01(a.confidence),
    })),
  };
}

// ── Ops: ask the live DB (read-only; answers only from the given state, with citations) ──────────────────────────────

const ASK_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['answer', 'issues', 'lines'],
  properties: {
    answer: { type: 'string', description: 'in the language of the question (Korean or English), ≤ 5 short sentences or a short list' },
    issues: { type: 'array', items: { type: 'integer' }, description: 'WV numbers you relied on' },
    lines: { type: 'array', items: { type: 'string' }, description: 'refs like "U4" of transcript lines you relied on' },
  },
} as const;

export async function askOps(question: string, context: string): Promise<{ answer: string; issues: number[]; lines: string[]; model: string }> {
  const model = config.OPENAI_TEXT_MODEL;
  const { text } = await respond({
    model,
    instructions: `You answer questions from event operations staff using ONLY the live tracker state and transcript lines given (they are current).
Be concrete: name issue keys (WV-12), people, teams, times. If the answer is not in the data, say so plainly. You cannot change anything; suggest who should act.
Reply in the language of the question (Korean → Korean, English → English), short; keep issue keys and zone names exactly as written. Cite every issue and transcript line you used.`,
    content: [{ type: 'input_text', text: `${context}\n\nQuestion: ${question.slice(0, 500)}\n\nAnswer in ${LANG_NOTE(replyLanguage(question))}.` }],
    schema: { name: 'ops_answer', schema: ASK_SCHEMA },
    maxOutputTokens: 700,
    timeoutMs: config.TEXT_TIMEOUT_MS + 5000,
  });
  const parsed = z.object({ answer: z.string(), issues: z.array(z.number().int()), lines: z.array(z.string()) }).safeParse(safeJson(text));
  if (!parsed.success) throw new AiError('AI_FAILED', 'The AI response was malformed.');
  return { model, answer: parsed.data.answer.trim().slice(0, 1500), issues: parsed.data.issues.slice(0, 10), lines: parsed.data.lines.slice(0, 10) };
}
