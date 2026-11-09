// Acceptance tests for the pure zone tracker (design: data/tracking-schema.json §11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveZone, emptyState } from '../server/zoneTrack.ts';
import type { ZoneSample, ZoneTrackState, ZoneType } from '../shared/contracts.ts';

const cam = (t: number, crowd: number, extra: Partial<ZoneSample> = {}): { cam: ZoneSample } =>
  ({ cam: { t, dev: 'd1', ok: true, conf: 0.85, crowd, people: [0, 3, 10, 25, 60][crowd], queue: 0, spill: false, seats: null, walk: null, hz: [], ...extra } });
const run = (type: ZoneType, inputs: Array<ReturnType<typeof cam> | { human: { src: 'staff'; t: number; crowd: number; label: string } }>) => {
  let st: ZoneTrackState = emptyState(0);
  const outs = [];
  for (const i of inputs) {
    const now = 'cam' in i ? i.cam.t : i.human.t;
    const o = deriveZone(st, i, { now, type, queueRate: null, then: [], siblings: [], source: { kind: 'camera', id: 'd1', label: 'Camera 1', at: now } });
    st = o.state; outs.push(o);
  }
  return { st, outs };
};

test('one hallucinated frame does not raise the tier: [1,1,1,4,1] stays clear', () => {
  const { st } = run('general', [1, 1, 1, 4, 1].map((c, i) => cam(i * 4000, c)));
  assert.equal(st.track.tier, 0);
  assert.ok((st.track.metrics.crowd ?? 9) <= 1.4, `score ${st.track.metrics.crowd}`);
});

test('critical needs at least 3 usable frames', () => {
  const two = run('general', [cam(0, 4), cam(4000, 4)]);
  assert.equal(two.st.track.tier, 0);
  const three = run('general', [cam(0, 4), cam(4000, 4), cam(8000, 4)]);
  assert.equal(three.st.track.tier, 3);
  assert.ok(three.outs[2].candidates.some((c) => c.type === 'overcrowding'));
});

test('critical → clear steps down one tier per 20 s (≥ 60 s total)', () => {
  const inputs = [cam(0, 4), cam(4000, 4), cam(8000, 4)];
  for (let t = 12_000; t <= 120_000; t += 4000) inputs.push(cam(t, 0));
  const { outs } = run('general', inputs);
  const firstClear = outs.findIndex((o) => o.state.track.tier === 0 && o.state.track.metrics.crowd != null && o.state.track.updatedAt > 8000);
  const tClear = outs[firstClear].state.track.updatedAt;
  assert.ok(tClear - 8000 >= 60_000, `cleared after ${tClear - 8000} ms`);
});

test('staff "critical" floors the tier for 120 s while a camera is fresh', () => {
  const inputs: Parameters<typeof run>[1] = [cam(0, 1), cam(4000, 1), cam(8000, 1), { human: { src: 'staff', t: 9000, crowd: 4, label: 'Jimin report' } }, cam(12_000, 1)];
  const { st } = run('general', inputs);
  assert.equal(st.track.tier, 3);
  const later = deriveZone(st, cam(9000 + 121_000, 1), { now: 130_000, type: 'general', queueRate: null, then: [], siblings: [], source: { kind: 'camera', id: 'd1', label: 'Camera 1', at: 130_000 } });
  assert.ok(later.state.track.tier < 3);
});

test('blocked in 1 of 3 frames does nothing; 2 of 3 opens obstruction (high in corridor)', () => {
  const one = run('corridor', [cam(0, 1, { walk: 0 }), cam(4000, 1, { walk: 2 }), cam(8000, 1, { walk: 0 })]);
  assert.ok(!one.outs.at(-1)!.candidates.some((c) => c.type === 'obstruction'));
  const two = run('corridor', [cam(0, 1, { walk: 2 }), cam(4000, 1, { walk: 0 }), cam(8000, 1, { walk: 2 })]);
  assert.ok(two.outs.at(-1)!.candidates.some((c) => c.type === 'obstruction'));
  assert.equal(two.st.track.tier, 2); // blocked corridor lifts the tier
});

test('life-safety hazard opens on one high-certainty frame; a spill needs 2 of 3', () => {
  const fire = run('general', [cam(0, 1, { hz: [{ type: 'fire_smoke', h: 0.85 }] })]);
  assert.ok(fire.outs[0].candidates.some((c) => c.type === 'fire_smoke'));
  const spill1 = run('general', [cam(0, 1, { hz: [{ type: 'spill', h: 0.85 }] })]);
  assert.ok(!spill1.outs[0].candidates.some((c) => c.type === 'spill'));
  const spill2 = run('general', [cam(0, 1, { hz: [{ type: 'spill', h: 0.85 }] }), cam(4000, 1, { hz: [{ type: 'spill', h: 0.6 }] })]);
  assert.ok(spill2.outs[1].candidates.some((c) => c.type === 'spill'));
});
