// Unit test for chooseMime (recorder mime fallback). Run: node --experimental-strip-types scripts/test-mime.mjs
import assert from 'node:assert/strict';
const { chooseMime } = await import('../web/src/comms/recorder.ts');
const safari = new Set(['audio/mp4']);
const chromeOld = new Set(['audio/webm', 'audio/webm;codecs=opus']);
const chromeNew = new Set(['audio/webm', 'audio/webm;codecs=opus', 'audio/mp4', 'audio/mp4;codecs=mp4a.40.2']);
const firefox = new Set(['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm']);
assert.equal(chooseMime((m) => safari.has(m)), 'audio/mp4');
assert.equal(chooseMime((m) => chromeOld.has(m)), 'audio/webm;codecs=opus');
assert.equal(chooseMime((m) => chromeNew.has(m)), 'audio/mp4;codecs=mp4a.40.2');
assert.equal(chooseMime((m) => firefox.has(m)), 'audio/webm;codecs=opus');
assert.equal(chooseMime(() => { throw new Error('old safari'); }), undefined);
assert.equal(chooseMime(() => false), undefined);
console.log('chooseMime: 6/6 ok');
