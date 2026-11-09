// Scribe capture: mic → 16 kHz mono PCM → simple VAD → WAV segments (cut on silence, ≤ SCRIBE_MAX_CHUNK_MS).
// Works on iOS Safari 16.4+ and Android Chrome: AudioWorklet (inline Blob module) with a ScriptProcessor fallback.
// Audio lives only in memory: each segment Blob is handed to the upload queue and released after upload.
import { SCRIBE_MAX_CHUNK_MS } from '@shared/contracts';
import { HttpError } from './api.ts';

export type ScribeState = 'idle' | 'starting' | 'listening' | 'paused' | 'error';
export type ScribeError = 'denied' | 'unsupported' | 'nomic' | 'mic_lost' | 'error';
export interface Segment { blob: Blob; startedAt: number; endedAt: number; seq: number; speechMs: number }

const RATE = 16_000;
const FRAME = 320;                 // 20 ms at 16 kHz
const FRAME_MS = 20;
const PREROLL_FRAMES = 15;         // 300 ms
const END_SILENCE_MS = 700;
const MIN_SPEECH_MS = 400;
const FORCE_LOOKBACK_FRAMES = 75;  // 1.5 s: where to look for the quietest cut point
const TAIL_KEEP_FRAMES = 10;       // keep 200 ms of trailing silence

const WORKLET = `
class WayvePcm extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) { this.port.postMessage(this.buf, [this.buf.buffer]); this.buf = new Float32Array(2048); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor('wayve-pcm', WayvePcm);
`;

/** Streaming box-filter decimator from the context rate to 16 kHz (enough for speech). */
class Downsampler {
  private carry: Float32Array = new Float32Array(0);
  private ratio: number;
  constructor(inputRate: number) { this.ratio = inputRate / RATE; }
  process(input: Float32Array): Float32Array {
    const data = this.carry.length ? concat(this.carry, input) : input;
    if (this.ratio === 1) { this.carry = new Float32Array(0); return data.slice(); }
    const n = Math.floor(data.length / this.ratio);
    const out = new Float32Array(n);
    for (let j = 0; j < n; j++) {
      const s = Math.floor(j * this.ratio);
      const e = Math.max(s + 1, Math.floor((j + 1) * this.ratio));
      let sum = 0;
      for (let k = s; k < e; k++) sum += data[k];
      out[j] = sum / (e - s);
    }
    this.carry = data.slice(Math.floor(n * this.ratio));
    return out;
  }
}

function concat(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

const rmsOf = (f: Float32Array) => {
  let s = 0;
  for (let i = 0; i < f.length; i++) s += f[i] * f[i];
  return Math.sqrt(s / f.length);
};

/** 16-bit PCM WAV, mono, 16 kHz. */
export function encodeWav(frames: Float32Array[]): Blob {
  const samples = frames.reduce((n, f) => n + f.length, 0);
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples * 2, true);
  let o = 44;
  for (const f of frames) {
    for (let i = 0; i < f.length; i++) {
      const x = Math.max(-1, Math.min(1, f[i]));
      v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([buf], { type: 'audio/wav' });
}

type Frame = { pcm: Float32Array; rms: number; speech: boolean; at: number };

export interface ScribeRecorderOpts {
  onSegment: (s: Segment) => void;
  onLevel?: (level: number) => void;
  onState?: (state: ScribeState, error: ScribeError | null) => void;
}

/**
 * Continuous recorder. `start()` must be called from a user gesture (iOS). Pausing disables the mic track (the OS mic
 * indicator stays, but no audio is processed) and flushes the open segment.
 */
export class ScribeRecorder {
  state: ScribeState = 'idle';
  error: ScribeError | null = null;
  private opts: ScribeRecorderOpts;
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private nodes: AudioNode[] = [];
  private down: Downsampler | null = null;
  private pending = new Float32Array(0);
  private floor = 0.01;
  private preroll: Frame[] = [];
  private seg: Frame[] | null = null;
  private segSpeechMs = 0;
  private silenceMs = 0;
  private seq = 0;
  private levelTick = 0;
  private smoothLevel = 0;

  constructor(opts: ScribeRecorderOpts) { this.opts = opts; }

  private set(state: ScribeState, error: ScribeError | null = null) {
    this.state = state;
    this.error = error;
    this.opts.onState?.(state, error);
  }

  async start(): Promise<void> {
    if (this.state === 'listening' || this.state === 'starting') return;
    if (this.state === 'paused') { this.resume(); return; }
    if (!navigator.mediaDevices?.getUserMedia || !(window.AudioContext || (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext)) {
      this.set('error', 'unsupported');
      return;
    }
    this.set('starting');
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    // Create + resume the context synchronously inside the gesture (iOS), before awaiting the mic prompt.
    const ctx = new Ctx();
    this.ctx = ctx;
    void ctx.resume().catch(() => {});
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch (e) {
      const name = (e as DOMException)?.name;
      this.cleanup();
      this.set('error', name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'nomic' : 'error');
      return;
    }
    const track = this.stream.getAudioTracks()[0];
    track?.addEventListener('ended', () => {
      if (this.state === 'listening' || this.state === 'paused') { this.flush(); this.cleanup(); this.set('error', 'mic_lost'); }
    });
    ctx.onstatechange = () => {
      // iOS reports 'interrupted' (calls, Siri) or 'suspended' (background); try to come back when allowed.
      const st = ctx.state as string;
      if ((st === 'interrupted' || st === 'suspended') && this.state === 'listening' && document.visibilityState === 'visible') {
        void ctx.resume().catch(() => {});
      }
    };
    this.down = new Downsampler(ctx.sampleRate);
    const source = ctx.createMediaStreamSource(this.stream);
    const sink = ctx.createGain();
    sink.gain.value = 0;
    sink.connect(ctx.destination);
    let node: AudioNode | null = null;
    try {
      if (!ctx.audioWorklet) throw new Error('no worklet');
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
      try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
      const w = new AudioWorkletNode(ctx, 'wayve-pcm', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      w.port.onmessage = (ev: MessageEvent<Float32Array>) => this.onPcm(ev.data);
      node = w;
    } catch {
      const sp = ctx.createScriptProcessor(4096, 1, 1);
      sp.onaudioprocess = (ev) => this.onPcm(new Float32Array(ev.inputBuffer.getChannelData(0)));
      node = sp;
    }
    source.connect(node);
    node.connect(sink);
    this.nodes = [source, node, sink];
    await ctx.resume().catch(() => {});
    this.set('listening');
  }

  pause() {
    if (this.state !== 'listening') return;
    this.flush();
    this.stream?.getAudioTracks().forEach((t) => { t.enabled = false; });
    this.set('paused');
    this.emitLevel(0, true);
  }

  resume() {
    if (this.state !== 'paused') return;
    this.stream?.getAudioTracks().forEach((t) => { t.enabled = true; });
    void this.ctx?.resume().catch(() => {});
    this.set('listening');
  }

  /** Re-wake the audio graph after the page comes back (iOS suspends it in the background). */
  wake() {
    if (this.state === 'listening' && this.ctx && this.ctx.state !== 'running') void this.ctx.resume().catch(() => {});
  }

  stop() {
    if (this.state === 'listening' || this.state === 'paused') this.flush();
    this.cleanup();
    this.set('idle');
    this.emitLevel(0, true);
  }

  private cleanup() {
    for (const n of this.nodes) { try { n.disconnect(); } catch { /* gone */ } }
    this.nodes = [];
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.ctx) { this.ctx.onstatechange = null; void this.ctx.close().catch(() => {}); }
    this.ctx = null;
    this.down = null;
    this.pending = new Float32Array(0);
    this.preroll = [];
    this.seg = null;
  }

  private onPcm(chunk: Float32Array) {
    if (this.state !== 'listening' || !this.down) return;
    const pcm = this.down.process(chunk);
    let data = this.pending.length ? concat(this.pending, pcm) : pcm;
    let off = 0;
    while (data.length - off >= FRAME) {
      this.onFrame(data.slice(off, off + FRAME));
      off += FRAME;
    }
    this.pending = data.slice(off);
    data = new Float32Array(0);
  }

  private onFrame(pcm: Float32Array) {
    const rms = rmsOf(pcm);
    // Adaptive noise floor: falls quickly to quiet frames, creeps up slowly.
    this.floor = rms < this.floor ? this.floor * 0.95 + rms * 0.05 : this.floor * 1.0005;
    this.floor = Math.min(0.05, Math.max(0.001, this.floor));
    const speech = rms > Math.max(this.floor * 3, 0.012);
    const f: Frame = { pcm, rms, speech, at: Date.now() };
    this.emitLevel(rms);

    if (!this.seg) {
      this.preroll.push(f);
      if (this.preroll.length > PREROLL_FRAMES) this.preroll.shift();
      if (speech) {
        this.seg = this.preroll.splice(0);
        this.segSpeechMs = FRAME_MS;
        this.silenceMs = 0;
      }
      return;
    }
    this.seg.push(f);
    if (speech) { this.segSpeechMs += FRAME_MS; this.silenceMs = 0; } else { this.silenceMs += FRAME_MS; }

    if (this.silenceMs >= END_SILENCE_MS) {
      const keep = this.seg.length - Math.round(this.silenceMs / FRAME_MS) + TAIL_KEEP_FRAMES;
      this.close(this.seg.slice(0, Math.max(1, keep)), this.segSpeechMs);
      this.seg = null;
      return;
    }
    if (this.seg.length * FRAME_MS >= SCRIBE_MAX_CHUNK_MS) {
      // Force cut at the quietest frame in the last 1.5 s; the rest starts the next segment.
      const from = Math.max(0, this.seg.length - FORCE_LOOKBACK_FRAMES);
      let cut = this.seg.length - 1;
      let best = Infinity;
      for (let i = from; i < this.seg.length; i++) if (this.seg[i].rms < best) { best = this.seg[i].rms; cut = i; }
      const head = this.seg.slice(0, cut + 1);
      const rest = this.seg.slice(cut + 1);
      const restSpeech = rest.filter((x) => x.speech).length * FRAME_MS;
      this.close(head, this.segSpeechMs - restSpeech);
      this.seg = rest.length ? rest : null;
      this.segSpeechMs = restSpeech;
      this.silenceMs = 0;
      if (this.seg && !this.seg.some((x) => x.speech)) { this.preroll = this.seg.slice(-PREROLL_FRAMES); this.seg = null; }
    }
  }

  private flush() {
    if (this.seg) this.close(this.seg, this.segSpeechMs);
    this.seg = null;
    this.preroll = [];
    this.segSpeechMs = 0;
    this.silenceMs = 0;
  }

  private close(frames: Frame[], speechMs: number) {
    if (!frames.length || speechMs < MIN_SPEECH_MS) return; // too little speech: likely noise (avoids silence hallucinations)
    const blob = encodeWav(frames.map((f) => f.pcm));
    const endedAt = frames[frames.length - 1].at;
    const startedAt = frames[0].at - FRAME_MS;
    this.opts.onSegment({ blob, startedAt, endedAt, seq: ++this.seq, speechMs });
  }

  private emitLevel(rms: number, force = false) {
    const target = Math.min(1, Math.pow(Math.min(1, rms / 0.15), 0.6));
    this.smoothLevel = target > this.smoothLevel ? target : this.smoothLevel * 0.85 + target * 0.15;
    if (force || ++this.levelTick % 3 === 0) this.opts.onLevel?.(force ? 0 : this.smoothLevel);
  }
}

// ── Upload queue: concurrency 1, retries with backoff, at most `maxPending` waiting (oldest dropped) ────────────────

export interface QueueState {
  pending: number;          // waiting + in flight
  inflight: boolean;
  dropped: number;          // segments we gave up on ("segments not sent")
  offline: boolean;         // last attempt failed on the network
  aiDisabled: boolean;      // server said AI_DISABLED (503)
  lastError: string | null;
}

type Item = { seg: Segment; attempts: number };

export class UploadQueue {
  private q: Item[] = [];
  private busy = false;
  private closed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private st: QueueState = { pending: 0, inflight: false, dropped: 0, offline: false, aiDisabled: false, lastError: null };
  private upload: (seg: Segment) => Promise<void>;
  private onChange: (s: QueueState) => void;
  private maxPending: number;

  constructor(upload: (seg: Segment) => Promise<void>, onChange: (s: QueueState) => void, maxPending = 6) {
    this.upload = upload;
    this.onChange = onChange;
    this.maxPending = maxPending;
  }

  private emit(patch: Partial<QueueState> = {}) {
    this.st = { ...this.st, ...patch, pending: this.q.length, inflight: this.busy };
    this.onChange(this.st);
  }

  push(seg: Segment) {
    if (this.closed) return;
    this.q.push({ seg, attempts: 0 });
    let dropped = this.st.dropped;
    // Never drop the head while it is in flight.
    while (this.q.length > this.maxPending) { this.q.splice(this.busy ? 1 : 0, 1); dropped++; }
    this.emit({ dropped });
    this.pump();
  }

  /** Retry now (e.g. back online / visible again). */
  kick() { clearTimeout(this.timer); this.timer = undefined; this.pump(); }

  close() { this.closed = true; clearTimeout(this.timer); this.timer = undefined; this.q = []; this.emit(); }
  reopen() { this.closed = false; }

  private pump() {
    if (this.busy || this.timer || this.closed || !this.q.length) return;
    const item = this.q[0];
    this.busy = true;
    this.emit();
    this.upload(item.seg).then(() => {
      this.q.shift();
      this.busy = false;
      this.emit({ offline: false, aiDisabled: false, lastError: null });
      this.pump();
    }).catch((e: unknown) => {
      this.busy = false;
      const he = e instanceof HttpError ? e : new HttpError(0, 'NETWORK', "Can't reach the server.");
      const permanent = he.status === 400 || he.status === 401 || he.status === 403 || he.status === 404 || he.status === 413;
      if (he.code === 'AI_DISABLED') {
        this.q.shift(); // nothing can transcribe it; don't keep retrying
        this.emit({ aiDisabled: true, offline: false, lastError: he.message });
        this.pump();
        return;
      }
      if (permanent) {
        this.q.shift();
        this.emit({ dropped: this.st.dropped + 1, offline: false, lastError: he.message });
        this.pump();
        return;
      }
      item.attempts++;
      const network = he.status === 0;
      if (!network && item.attempts > 3) {
        this.q.shift();
        this.emit({ dropped: this.st.dropped + 1, offline: false, lastError: he.message });
        this.pump();
        return;
      }
      // Network errors retry until the queue cap pushes them out; server errors back off 1 s → 2 s → 4 s.
      const wait = he.code === 'BUSY' ? 1000 : [1000, 2000, 4000][Math.min(2, item.attempts - 1)];
      this.emit({ offline: network, lastError: he.message });
      this.timer = setTimeout(() => { this.timer = undefined; this.pump(); }, wait);
    });
  }
}
