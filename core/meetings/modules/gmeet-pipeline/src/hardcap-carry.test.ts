/**
 * Hard-cap force-flush must not drop speech.
 *
 * Continuous speech never confirms (each submission's text keeps growing), so once the buffer
 * passes maxBufferDuration the manager force-flushes the last transcript. That transcript covers
 * only the audio of the submission that produced it; everything spoken between that submission
 * and the flush is not in it. Those seconds must carry into the next window, not be discarded —
 * and the flushed segment must end where its transcript ends, not at the end of the buffer.
 *
 * Model-free: every second of audio carries a distinct constant level; the scripted STT decodes
 * the submitted window back into one word per second (`s0 s1 …`), so a lost second is a missing
 * word. Timers are never started (huge submitInterval); trySubmit is driven explicitly.
 *
 *   tsx src/hardcap-carry.test.ts
 */
import { SpeakerStreamManager } from './speaker-streams.js';

let checks = 0;
function ok(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
  console.log(`  ✅ ${msg}`);
  checks++;
}

const SR = 16000;
const SID = 'ch-0:1';
const T0 = 1_700_000_000_000;
const level = (sec: number) => 0.01 + sec * 0.001;
const secondOf = (v: number) => Math.round((v - 0.01) / 0.001);

const mgr = new SpeakerStreamManager({ submitInterval: 3600, minAudioDuration: 2, maxBufferDuration: 30 });
const confirmed: { text: string; startMs: number; endMs: number }[] = [];
let submitted: Float32Array | null = null;
mgr.onSegmentReady = (_id, _name, audio) => { submitted = audio; };
mgr.onSegmentConfirmed = (_id, _name, text, startMs, endMs) => confirmed.push({ text, startMs, endMs });
mgr.addSpeaker(SID, 'A D');

let fed = 0;
function feedUntil(sec: number): void {
  for (; fed < sec; fed++) mgr.feedAudio(SID, new Float32Array(SR).fill(level(fed)), T0 + fed * 1000);
}
/** Answer the outstanding submission the way a perfect STT would: one word per second sent. */
function answer(): void {
  const audio = submitted;
  if (!audio) return;
  submitted = null;
  const words: string[] = [];
  for (let off = 0; off < audio.length; off += SR) words.push(`s${secondOf(audio[off])}`);
  mgr.handleTranscriptionResult(SID, words.join(' '));
}
async function tick(): Promise<void> {
  await (mgr as any).trySubmit(SID);
  answer();
}

(async () => {
  console.log('hard-cap force-flush (continuous speech, never confirms)');
  for (const sec of [6, 12, 18, 24, 30, 36, 42, 48]) { feedUntil(sec); await tick(); }
  await mgr.flushSpeaker(SID, true);
  answer();

  const spoken = confirmed.flatMap((c) => c.text.split(' ')).map((w) => Number(w.slice(1)));
  const missing = Array.from({ length: 48 }, (_, i) => i).filter((s) => !spoken.includes(s));
  console.log(`  segments: ${confirmed.map((c) => `[${c.text.split(' ')[0]}…${c.text.split(' ').at(-1)}]`).join(' ')}`);
  ok(missing.length === 0, `every spoken second reaches the transcript (missing: ${missing.join(',') || 'none'})`);
  ok(new Set(spoken).size === spoken.length, 'no second is transcribed twice');

  const forced = confirmed[0];
  ok(forced.endMs === T0 + 30_000, `force-flushed segment ends where its transcript ends (${forced.endMs - T0}ms, want 30000)`);
  if (confirmed[1]) {
    ok(confirmed[1].startMs === T0 + 30_000, `the carried window starts at the first untranscribed second (${confirmed[1].startMs - T0}ms, want 30000)`);
  }

  mgr.removeAll();
  console.log(`\nPASS (${checks})`);
  process.exit(0);
})().catch((e) => { console.error(`\nFAIL: ${e.message}`); process.exit(1); });
