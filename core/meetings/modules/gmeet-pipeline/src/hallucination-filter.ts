/**
 * Hallucination filter for post-transcription filtering.
 *
 * Catches known hallucination phrases, repetition loops, and junk output before it
 * reaches the transcript. Phrase files loaded from hallucinations/*.txt (shipped to
 * dist/ by the build). ESM: the dir is resolved from import.meta.url, so it works
 * the same run-from-src (tsx) and run-from-dist (built).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from './log.js';

const here = dirname(fileURLToPath(import.meta.url));
let phrases: Set<string> | null = null;

/** Lower-cased, trailing sentence punctuation removed — applied to list entries and input alike,
 *  so "Vielen Dank." in a list matches "vielen dank" from the STT and vice versa. */
const normalize = (s: string): string => s.trim().toLowerCase().replace(/[.!?…]+$/g, '').trim();

function loadPhrases(): Set<string> {
  if (phrases) return phrases;
  phrases = new Set();

  const dir = resolve(here, 'hallucinations');   // src/hallucinations (tsx) ‖ dist/hallucinations (built)
  try {
    if (existsSync(dir)) {
      for (const file of readdirSync(dir)) {
        if (!file.endsWith('.txt')) continue;
        const content = readFileSync(join(dir, file), 'utf-8');
        for (const line of content.split('\n')) {
          const t = line.trim();
          if (t && !t.startsWith('#')) {
            const n = normalize(t);
            if (n) phrases.add(n);
          }
        }
      }
    }
  } catch { /* fall through to the empty-set warning */ }

  if (phrases.size > 0) log(`[HallucinationFilter] Loaded ${phrases.size} phrases from ${dir}`);
  else log('[HallucinationFilter] WARNING: No phrase files found');
  return phrases;
}

/**
 * Returns true if the text is a hallucination and should be dropped.
 */
export function isHallucination(text: string): boolean {
  if (!text?.trim()) return true;

  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  // Known phrase, compared with trailing punctuation normalized on both sides
  const db = loadPhrases();
  if (db.has(normalize(lower))) return true;

  // Too short (single word < 10 chars)
  const words = trimmed.split(/\s+/);
  if (words.length <= 1 && trimmed.length < 10) return true;

  // Repetition loop: same 3-6 word phrase repeated 3+ times
  if (words.length >= 9) {
    for (let len = 3; len <= 6; len++) {
      const phrase = words.slice(0, len).join(' ').toLowerCase();
      let count = 0;
      for (let i = 0; i <= words.length - len; i += len) {
        if (words.slice(i, i + len).join(' ').toLowerCase() === phrase) count++;
      }
      if (count >= 3) return true;
    }
  }

  return false;
}

// The low-confidence STT-segment filter (isLowConfidenceSegment) lives in
// @vexa/transcribe-whisper (src/confidence.ts) — it belongs at the stt.v1 egress,
// applied to Whisper's raw output before the confirm loop. This module keeps only
// the phrase-list hallucination filter (isHallucination), a downstream concern.
