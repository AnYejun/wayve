// Live device pulses: ephemeral "this device is working right now" signals (never stored).
// Published on every camera frame received (before AI), every scribe audio chunk, every heartbeat.
import type { DevicePulse } from '../shared/contracts.ts';
import { eventChannel, publish } from './sse.ts';

export function emitPulse(eventId: string, deviceId: string, kind: DevicePulse['kind'], level: number | null = null) {
  const p: DevicePulse = { deviceId, kind, level: level == null ? null : Math.max(0, Math.min(1, level)), at: Date.now() };
  publish(eventChannel(eventId), 'pulse', p);
}
