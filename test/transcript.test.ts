// Silence and prompt echoes from the speech model must read as "no speech"; real speech (Korean, English, mixed) passes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanTranscript, replyLanguage } from '../server/ai.ts';

const PROMPT = 'Event operations radio and meetings, in Korean, English, or a mix of both (transcribe verbatim, keep each word in the language spoken). Common terms: name badge, lanyard, wristband, registration, check-in, extension cord, power strip, Wi-Fi, mic, projector, queue, spill, first aid. Korean terms: 명찰, 연장선, 무대, 입구. Names and places: HQ, Registration, Stage, Hospitality, Safety, Tiered Seating, Lounge A, Lounge B, Lounge C, Entrance Lounge, Entrance, Coffee Corner, Junmin, Joosun';

test('the prompt echoed back on silence is dropped', () => {
  assert.equal(cleanTranscript(PROMPT, PROMPT), '');
  assert.equal(cleanTranscript('Names and places: HQ, Registration, Stage, Hospitality, Safety, Tiered Seating', PROMPT), '');
  assert.equal(cleanTranscript('Stage, Lounge A, Lounge B, Lounge C, Entrance Lounge, Entrance, Coffee Corner', PROMPT), '');
  // seen live on room hiss: the prompt translated into Korean
  assert.equal(cleanTranscript('이벤트 운영 라디오 및 미팅, 한국어, 영어 또는 혼합 언어로 진행됩니다. 일반 용어: 명찰, 연장선, 무대, 입구. 이름 및 장소: HQ, Registration, Stage', PROMPT), '');
  assert.equal(cleanTranscript('명찰, 연장선, 무대, 입구, HQ, Registration, Stage, Hospitality', PROMPT), '');
});

test('stock silence phrases are dropped', () => {
  for (const s of ['Thank you.', 'Thanks for watching!', '시청해 주셔서 감사합니다.', 'MBC 뉴스 이덕영입니다.', '...', 'you']) assert.equal(cleanTranscript(s, PROMPT), '', s);
});

test('real speech is kept, including speech that uses venue words', () => {
  for (const s of ['입구에 줄이 길어지고 있어요', 'We need two extension cords at Lounge B', 'Junmin, 무대 쪽 마이크 하나 더 가져와 주세요',
    'Queue at the Entrance is about twenty people, can someone from Registration help?', '감사합니다',
    'Registration needs more name badges, lanyards and wristbands, the Wi-Fi is down at Lounge A, bring an extension cord and a power strip to the Stage, and check the queue']) assert.equal(cleanTranscript(s, PROMPT), s, s);
});

test('reply language is decided from the message', () => {
  assert.equal(replyLanguage('점심은 언제 나와요?'), 'Korean');
  assert.equal(replyLanguage('When is the submission deadline?'), 'English');
  assert.equal(replyLanguage('Stage 쪽 Wi-Fi 비번 뭐예요?'), 'Korean');
  assert.equal(replyLanguage('What does WV-12 mean, Junmin?'), 'English');
});
