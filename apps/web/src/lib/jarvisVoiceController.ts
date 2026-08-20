/**
 * Central Jarvis TTS controller — ONE speechSynthesis owner.
 *
 * ROOT CAUSES of "Hi" then silence (audit findings):
 * 1) speakableLead() truncated long replies to the FIRST sentence only.
 * 2) Mute incorrectly called interruptJarvisVoice() and cancelled mid-greeting.
 * 3) Chrome often fails mid-utterance on long text without sentence chunking.
 * 4) Competing speak() / cancel() from tool narration & overlapping speakReply.
 *
 * Fix: sentence-level queue, retain utterance refs, mute ≠ cancel TTS,
 * cancel only with explicit reason (USER_STOP | NEW_REQUEST | SYSTEM_RESET).
 */

import { canUseSpeechSynthesis } from '@/components/NexoraPresence';
import { jarvisLog } from '@/lib/jarvisLog';

export type CancelReason = 'USER_STOP' | 'NEW_REQUEST' | 'SYSTEM_RESET' | 'ERROR' | 'MUTE_REMOVED';

export type VoiceSpeakStatus =
  | 'started'
  | 'completed'
  | 'blocked'
  | 'unsupported'
  | 'error'
  | 'empty'
  | 'interrupted';

export type VoiceSpeakResult = {
  status: VoiceSpeakStatus;
  reason?: string;
};

export type VoiceSpeakOptions = {
  preferMale?: boolean;
  lang?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  /** Cancel current speech and start this response (user barge-in / new reply). */
  interrupt?: boolean;
  startTimeoutMs?: number;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (reason: string) => void;
  onChunkStart?: (chunk: string, index: number, total: number) => void;
};

/** Retained so Chrome cannot GC utterances mid-speech. */
let activeUtterance: SpeechSynthesisUtterance | null = null;
let speakGeneration = 0;
let queueDraining = false;
let chromeKeepAliveTimer: ReturnType<typeof setInterval> | null = null;
let cachedVoices: SpeechSynthesisVoice[] | null = null;

type ChunkJob = {
  chunks: string[];
  opts: VoiceSpeakOptions;
  resolve: (r: VoiceSpeakResult) => void;
};

let jobQueue: ChunkJob[] = [];

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getSpeakGeneration(): number {
  return speakGeneration;
}

export function isJarvisSpeaking(): boolean {
  if (typeof window === 'undefined' || !window.speechSynthesis) return false;
  return window.speechSynthesis.speaking || Boolean(activeUtterance) || queueDraining;
}

function stopChromeKeepAlive() {
  if (chromeKeepAliveTimer) {
    clearInterval(chromeKeepAliveTimer);
    chromeKeepAliveTimer = null;
  }
}

function startChromeKeepAlive(gen: number) {
  stopChromeKeepAlive();
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  chromeKeepAliveTimer = setInterval(() => {
    if (gen !== speakGeneration) {
      stopChromeKeepAlive();
      return;
    }
    try {
      if (window.speechSynthesis.speaking) {
        window.speechSynthesis.resume();
      }
    } catch {
      // ignore
    }
  }, 4000);
}

/** Strip markdown for speech — do NOT truncate to a lead sentence. */
export function prepareSpeakableText(markdown: string, maxChars = 2500): string {
  return String(markdown || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]+`/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_#>]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
}

/** Prefer one sentence per chunk so Chrome cannot drop mid-paragraph speech. */
export function splitIntoSpeechChunks(text: string, maxChunkLen = 280): string[] {
  const clean = prepareSpeakableText(text);
  if (!clean) return [];

  const raw = clean.match(/[^.!?]+[.!?]+(?:["')\]]+)?|[^.!?]+$/g) || [clean];
  const sentences = raw.map((s) => s.trim()).filter(Boolean);
  const chunks: string[] = [];

  for (const sentence of sentences) {
    if (sentence.length <= maxChunkLen) {
      chunks.push(sentence);
      continue;
    }
    let rest = sentence;
    while (rest.length > maxChunkLen) {
      let cut = rest.lastIndexOf(',', maxChunkLen);
      if (cut < maxChunkLen * 0.4) cut = rest.lastIndexOf(' ', maxChunkLen);
      if (cut < maxChunkLen * 0.4) cut = maxChunkLen;
      chunks.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).replace(/^[,.\s]+/, '').trim();
    }
    if (rest) chunks.push(rest);
  }
  return chunks.filter(Boolean);
}

export async function ensureSpeechVoices(timeoutMs = 1500): Promise<SpeechSynthesisVoice[]> {
  if (!canUseSpeechSynthesis()) return [];
  if (cachedVoices?.length) return cachedVoices;
  const existing = window.speechSynthesis.getVoices();
  if (existing.length) {
    cachedVoices = existing;
    return existing;
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.speechSynthesis.removeEventListener('voiceschanged', onChange);
      cachedVoices = window.speechSynthesis.getVoices();
      resolve(cachedVoices);
    };
    const onChange = () => finish();
    window.speechSynthesis.addEventListener('voiceschanged', onChange);
    window.setTimeout(finish, timeoutMs);
  });
}

export function pickJarvisVoice(voices: SpeechSynthesisVoice[], preferLang?: string): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const english = voices.filter((v) => /^en/i.test(v.lang) || /english/i.test(v.name));
  const pool = english.length ? english : voices;

  const score = (v: SpeechSynthesisVoice): number => {
    let s = 0;
    const name = v.name || '';
    const lang = v.lang || '';
    const male = /male|david|daniel|alex|fred|ravi|thomas|mark|guy|james|george|sean|arthur|aaron/i.test(name);
    const female = /female|samantha|karen|moira|tessa|veena|zira|susan|fiona|victoria|heera/i.test(name);
    if (female && !male) s -= 50;
    if (male) s += 40;
    if (/en-IN/i.test(lang) || /india/i.test(name)) s += 40;
    if (/en-GB/i.test(lang)) s += 18;
    if (/en-US/i.test(lang)) s += 14;
    if (preferLang && new RegExp(`^${preferLang}`, 'i').test(lang)) s += 10;
    if (/natural|neural|premium|enhanced/i.test(name)) s += 12;
    return s;
  };

  return [...pool].sort((a, b) => score(b) - score(a))[0] || null;
}

export function pickMaleVoice(voices: SpeechSynthesisVoice[], lang = 'en'): SpeechSynthesisVoice | null {
  return pickJarvisVoice(voices, lang);
}

/**
 * Cancel only with an explicit reason. Never call from mute/mic/route alone.
 */
export function interruptJarvisVoice(reason: CancelReason = 'USER_STOP'): void {
  jarvisLog('TTS_CANCEL', { reason });
  speakGeneration += 1;
  const pending = jobQueue.splice(0);
  pending.forEach((j) => j.resolve({ status: 'interrupted', reason }));
  queueDraining = false;
  stopChromeKeepAlive();
  activeUtterance = null;
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // ignore
  }
}

export function interruptNexoraSpeech(): void {
  interruptJarvisVoice('USER_STOP');
}

async function speakChunk(text: string, opts: VoiceSpeakOptions, gen: number): Promise<VoiceSpeakResult> {
  if (!canUseSpeechSynthesis()) return { status: 'unsupported' };
  if (!text.trim()) return { status: 'empty' };
  if (gen !== speakGeneration) return { status: 'interrupted', reason: 'superseded' };

  const voices = await ensureSpeechVoices();
  if (gen !== speakGeneration) return { status: 'interrupted', reason: 'superseded' };
  const voice = opts.preferMale === false ? null : pickJarvisVoice(voices, opts.lang);
  const startTimeoutMs = opts.startTimeoutMs ?? 2500;

  // Only cancel if something else is somehow still speaking from outside our queue
  if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
    await wait(50);
  }
  if (gen !== speakGeneration) return { status: 'interrupted', reason: 'superseded' };

  const utterance = new SpeechSynthesisUtterance(text);
  activeUtterance = utterance;
  utterance.rate = typeof opts.rate === 'number' ? opts.rate : 0.9;
  utterance.pitch = typeof opts.pitch === 'number' ? opts.pitch : 0.95;
  utterance.volume = typeof opts.volume === 'number' ? opts.volume : 1;
  utterance.lang =
    opts.lang || voice?.lang || (typeof navigator !== 'undefined' ? navigator.language : 'en-IN') || 'en-IN';
  if (voice) utterance.voice = voice;

  return await new Promise<VoiceSpeakResult>((resolve) => {
    let settled = false;
    let timer = 0;
    const settle = (result: VoiceSpeakResult) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      stopChromeKeepAlive();
      if (activeUtterance === utterance) activeUtterance = null;
      resolve(result);
    };

    utterance.onstart = () => {
      if (gen !== speakGeneration) {
        settle({ status: 'interrupted', reason: 'superseded' });
        return;
      }
      startChromeKeepAlive(gen);
      window.clearTimeout(timer);
    };

    utterance.onend = () => {
      if (gen !== speakGeneration) {
        settle({ status: 'interrupted', reason: 'superseded' });
        return;
      }
      settle({ status: 'completed' });
    };

    utterance.onerror = (event) => {
      const reason = String((event as SpeechSynthesisErrorEvent).error || 'speech_error');
      jarvisLog('TTS_ERROR', reason);
      if (reason === 'canceled' || reason === 'interrupted') {
        settle({ status: 'interrupted', reason });
        return;
      }
      if (reason === 'not-allowed' || reason === 'synthesis-failed') {
        opts.onError?.(reason);
        settle({ status: 'blocked', reason });
        return;
      }
      opts.onError?.(reason);
      settle({ status: 'error', reason });
    };

    timer = window.setTimeout(() => {
      if (gen !== speakGeneration) {
        settle({ status: 'interrupted', reason: 'superseded' });
        return;
      }
      if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
        settle({
          status: 'blocked',
          reason: 'Browser blocked automatic speech. Click Enable voice.',
        });
      }
    }, startTimeoutMs);

    try {
      window.speechSynthesis.speak(utterance);
      if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    } catch (err) {
      settle({
        status: 'error',
        reason: err instanceof Error ? err.message : 'speak_failed',
      });
    }
  });
}

async function runJob(job: ChunkJob): Promise<void> {
  const gen = speakGeneration;
  const { chunks, opts, resolve } = job;
  if (!chunks.length) {
    resolve({ status: 'empty' });
    return;
  }

  jarvisLog('TTS_START', { chunks: chunks.length, preview: chunks[0]?.slice(0, 80) });
  opts.onStart?.();

  let anyStarted = false;
  for (let i = 0; i < chunks.length; i++) {
    if (gen !== speakGeneration) {
      resolve({ status: 'interrupted', reason: 'superseded' });
      return;
    }
    const chunk = chunks[i];
    jarvisLog('TTS_CHUNK', { index: i + 1, total: chunks.length, preview: chunk.slice(0, 80) });
    opts.onChunkStart?.(chunk, i, chunks.length);
    const result = await speakChunk(chunk, opts, gen);
    if (result.status === 'completed') {
      anyStarted = true;
      continue;
    }
    if (result.status === 'interrupted') {
      resolve(result);
      return;
    }
    if (result.status === 'blocked' || result.status === 'unsupported' || result.status === 'error') {
      // If we already spoke some chunks, treat as completed-with-error rather than total fail
      if (anyStarted && result.status === 'error') {
        jarvisLog('TTS_ERROR', { recovered: true, reason: result.reason });
        continue;
      }
      resolve(result);
      return;
    }
  }

  jarvisLog('TTS_END', { chunks: chunks.length });
  opts.onEnd?.();
  resolve({ status: anyStarted || chunks.length ? 'completed' : 'empty' });
}

async function drainJobs(): Promise<void> {
  if (queueDraining) return;
  queueDraining = true;
  try {
    while (jobQueue.length > 0) {
      const job = jobQueue.shift();
      if (!job) break;
      await runJob(job);
    }
  } finally {
    queueDraining = false;
    if (jobQueue.length > 0) void drainJobs();
  }
}

/**
 * Speak a full response (multi-sentence). Chunks sequentially until complete.
 */
export function speakJarvis(text: string, opts: VoiceSpeakOptions = {}): Promise<VoiceSpeakResult> {
  const chunks = splitIntoSpeechChunks(text);
  if (!chunks.length) return Promise.resolve({ status: 'empty' });

  if (opts.interrupt) {
    interruptJarvisVoice('NEW_REQUEST');
  }

  return new Promise<VoiceSpeakResult>((resolve) => {
    jobQueue.push({ chunks, opts, resolve });
    void drainJobs();
  });
}

/** Compatibility: maps completed → started for older greeting callers. */
export async function speakNexoraReliable(
  text: string,
  opts: VoiceSpeakOptions & { muted?: boolean } = {}
): Promise<VoiceSpeakResult> {
  if (opts.muted) return { status: 'interrupted', reason: 'muted_compat' };
  const result = await speakJarvis(text, { ...opts, interrupt: true });
  if (result.status === 'completed') return { status: 'started', reason: result.reason };
  return result;
}

export async function enableAndSpeak(text: string, opts: VoiceSpeakOptions = {}): Promise<VoiceSpeakResult> {
  if (!canUseSpeechSynthesis()) return { status: 'unsupported' };
  try {
    window.speechSynthesis.cancel();
    const warm = new SpeechSynthesisUtterance('.');
    warm.volume = 0;
    warm.rate = 2;
    activeUtterance = warm;
    window.speechSynthesis.speak(warm);
    await wait(40);
    window.speechSynthesis.cancel();
    activeUtterance = null;
  } catch {
    activeUtterance = null;
  }
  return speakJarvis(text, { ...opts, preferMale: opts.preferMale !== false, interrupt: true });
}

/** @deprecated Mute no longer cancels TTS — kept for import compatibility. */
export function setJarvisVoiceMuted(_next: boolean): void {
  // Mic mute is owned by JarvisProvider. Do not cancel speech here.
}

export function isJarvisVoiceMuted(): boolean {
  return false;
}

export function __resetJarvisVoiceForTests(): void {
  interruptJarvisVoice('SYSTEM_RESET');
  cachedVoices = null;
  jobQueue = [];
  queueDraining = false;
}

/** Legacy alias used by NexoraPresence consumers */
export function speakableText(markdown: string, maxChars = 2500): string {
  return prepareSpeakableText(markdown, maxChars);
}
