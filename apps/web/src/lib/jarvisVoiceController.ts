/**
 * Central Jarvis voice controller — ONE authoritative speechSynthesis owner.
 *
 * Root-cause fix for "speaks one word / Hey then stops":
 * Chrome garbage-collects SpeechSynthesisUtterance when nothing retains a reference.
 * We keep `activeUtterance` at module scope until onend/onerror/interrupt.
 *
 * Also: single queue, mute = output only (not mic), Chrome pause-keepalive.
 */

import { speakableText, canUseSpeechSynthesis } from '@/components/NexoraPresence';

export type VoiceSpeakStatus =
  | 'started'
  | 'completed'
  | 'blocked'
  | 'muted'
  | 'unsupported'
  | 'error'
  | 'empty'
  | 'interrupted';

export type VoiceSpeakResult = {
  status: VoiceSpeakStatus;
  reason?: string;
};

export type VoiceSpeakOptions = {
  /** Prefer natural male English / Indian English when available */
  preferMale?: boolean;
  lang?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  /** If true, cancel current speech and speak this immediately */
  interrupt?: boolean;
  /** How long to wait for onstart before treating as autoplay block */
  startTimeoutMs?: number;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (reason: string) => void;
};

type QueueItem = {
  text: string;
  opts: VoiceSpeakOptions;
  resolve: (r: VoiceSpeakResult) => void;
};

/** Retained so Chrome cannot GC the utterance mid-speech. */
let activeUtterance: SpeechSynthesisUtterance | null = null;
let speakGeneration = 0;
let muted = false;
let queue: QueueItem[] = [];
let draining = false;
let chromeKeepAliveTimer: ReturnType<typeof setInterval> | null = null;
let cachedVoices: SpeechSynthesisVoice[] | null = null;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isJarvisVoiceMuted(): boolean {
  return muted;
}

/** Mute = no voice OUTPUT. Does not affect microphone / listening. */
export function setJarvisVoiceMuted(next: boolean): void {
  muted = next;
  if (next) {
    interruptJarvisVoice();
  }
}

export function getSpeakGeneration(): number {
  return speakGeneration;
}

export function isJarvisSpeaking(): boolean {
  if (typeof window === 'undefined' || !window.speechSynthesis) return false;
  return window.speechSynthesis.speaking || Boolean(activeUtterance);
}

function stopChromeKeepAlive() {
  if (chromeKeepAliveTimer) {
    clearInterval(chromeKeepAliveTimer);
    chromeKeepAliveTimer = null;
  }
}

/** Chrome silently pauses long utterances — nudge resume while we own speech. */
function startChromeKeepAlive(gen: number) {
  stopChromeKeepAlive();
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  chromeKeepAliveTimer = setInterval(() => {
    if (gen !== speakGeneration) {
      stopChromeKeepAlive();
      return;
    }
    try {
      if (window.speechSynthesis.speaking && window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      } else if (window.speechSynthesis.speaking) {
        // Known Chrome workaround: resume() even when not paused keeps audio alive
        window.speechSynthesis.resume();
      }
    } catch {
      // ignore
    }
  }, 5000);
}

/** Hard stop — clears queue and cancels current utterance. */
export function interruptJarvisVoice(): void {
  speakGeneration += 1;
  const pending = queue.splice(0);
  pending.forEach((item) => item.resolve({ status: 'interrupted', reason: 'interrupted' }));
  draining = false;
  stopChromeKeepAlive();
  activeUtterance = null;
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // ignore
  }
}

/** @deprecated use interruptJarvisVoice */
export function interruptNexoraSpeech(): void {
  interruptJarvisVoice();
}

export async function ensureSpeechVoices(timeoutMs = 1500): Promise<SpeechSynthesisVoice[]> {
  if (!canUseSpeechSynthesis()) return [];
  if (cachedVoices && cachedVoices.length > 0) return cachedVoices;

  const existing = window.speechSynthesis.getVoices();
  if (existing.length > 0) {
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

/**
 * Dynamic male English voice selection — never hardcodes a single browser voice.
 * Priority: en-IN male → natural male names → en-US/UK male → any English → default.
 */
export function pickJarvisVoice(voices: SpeechSynthesisVoice[], preferLang?: string): SpeechSynthesisVoice | null {
  if (!voices.length) return null;

  const english = voices.filter((v) => /^en/i.test(v.lang) || /english/i.test(v.name));
  const pool = english.length ? english : voices;

  const score = (v: SpeechSynthesisVoice): number => {
    let s = 0;
    const name = v.name || '';
    const lang = v.lang || '';
    const maleHint = /male|david|daniel|alex|fred|ravi|thomas|mark|guy|james|george|sean|arthur|aaron/i.test(name);
    const femaleHint = /female|samantha|karen|moira|tessa|veena|zira|susan|fiona|victoria/i.test(name);
    if (femaleHint && !maleHint) s -= 50;
    if (maleHint) s += 40;
    if (/en-IN/i.test(lang) || /india/i.test(name)) s += 35;
    if (/en-GB/i.test(lang) || /uk english/i.test(name)) s += 20;
    if (/en-US/i.test(lang)) s += 15;
    if (preferLang && new RegExp(`^${preferLang}`, 'i').test(lang)) s += 10;
    if (/natural|neural|premium|enhanced/i.test(name)) s += 12;
    if (/google/i.test(name)) s += 5;
    if (/microsoft/i.test(name)) s += 4;
    return s;
  };

  const ranked = [...pool].sort((a, b) => score(b) - score(a));
  return ranked[0] || null;
}

/** @deprecated alias */
export function pickMaleVoice(voices: SpeechSynthesisVoice[], lang = 'en'): SpeechSynthesisVoice | null {
  return pickJarvisVoice(voices, lang);
}

async function speakNow(text: string, opts: VoiceSpeakOptions): Promise<VoiceSpeakResult> {
  if (muted) return { status: 'muted' };
  if (!canUseSpeechSynthesis()) {
    return { status: 'unsupported', reason: 'Speech synthesis is not available in this browser.' };
  }

  const clean = speakableText(text, 1200);
  if (!clean) return { status: 'empty' };

  const voices = await ensureSpeechVoices();
  const voice = opts.preferMale === false ? null : pickJarvisVoice(voices, opts.lang);
  const startTimeoutMs = opts.startTimeoutMs ?? 2000;
  const myGen = ++speakGeneration;

  try {
    window.speechSynthesis.cancel();
    // Chrome needs a beat after cancel before the next speak is reliable
    await wait(60);
    if (myGen !== speakGeneration) return { status: 'interrupted', reason: 'superseded' };

    const utterance = new SpeechSynthesisUtterance(clean);
    // Hold reference — prevents Chrome GC mid-speech ("Hey" then silence)
    activeUtterance = utterance;

    utterance.rate = typeof opts.rate === 'number' ? opts.rate : 0.9;
    utterance.pitch = typeof opts.pitch === 'number' ? opts.pitch : 0.95;
    utterance.volume = typeof opts.volume === 'number' ? opts.volume : 1;
    utterance.lang = opts.lang || voice?.lang || (typeof navigator !== 'undefined' ? navigator.language : 'en-US') || 'en-US';
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
        if (myGen !== speakGeneration) {
          settle({ status: 'interrupted', reason: 'superseded' });
          return;
        }
        startChromeKeepAlive(myGen);
        opts.onStart?.();
        window.clearTimeout(timer);
      };

      utterance.onend = () => {
        if (myGen !== speakGeneration) {
          settle({ status: 'interrupted', reason: 'superseded' });
          return;
        }
        opts.onEnd?.();
        settle({ status: 'completed' });
      };

      utterance.onerror = (event) => {
        const reason = String((event as SpeechSynthesisErrorEvent).error || 'speech_error');
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
        if (myGen !== speakGeneration) {
          settle({ status: 'interrupted', reason: 'superseded' });
          return;
        }
        const speaking = window.speechSynthesis.speaking || window.speechSynthesis.pending;
        if (!speaking) {
          try {
            window.speechSynthesis.cancel();
          } catch {
            // ignore
          }
          settle({
            status: 'blocked',
            reason: 'Browser blocked automatic speech. Click Enable voice to hear Jarvis.',
          });
        }
      }, startTimeoutMs);

      try {
        window.speechSynthesis.speak(utterance);
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
      } catch (err) {
        settle({
          status: 'error',
          reason: err instanceof Error ? err.message : 'speak_failed',
        });
      }
    });
  } catch (err) {
    activeUtterance = null;
    return {
      status: 'error',
      reason: err instanceof Error ? err.message : 'speak_failed',
    };
  }
}

async function drainQueue(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (queue.length > 0) {
      if (muted) {
        const item = queue.shift();
        item?.resolve({ status: 'muted' });
        continue;
      }
      const item = queue.shift();
      if (!item) break;
      const result = await speakNow(item.text, item.opts);
      item.resolve(result);
      // If interrupted intentionally, remaining queue already cleared by interruptJarvisVoice
      if (result.status === 'interrupted' && queue.length === 0) break;
    }
  } finally {
    draining = false;
    if (queue.length > 0) void drainQueue();
  }
}

/**
 * Enqueue speech. Completes only after the utterance ends (or is interrupted/blocked).
 * Use `interrupt: true` to stop current speech and speak immediately (user barge-in / new reply).
 */
export function speakJarvis(text: string, opts: VoiceSpeakOptions = {}): Promise<VoiceSpeakResult> {
  if (muted) return Promise.resolve({ status: 'muted' });
  if (opts.interrupt) {
    // Clear pending queue but keep generation bump via interrupt, then re-queue this item
    speakGeneration += 1;
    const waiting = queue.splice(0);
    waiting.forEach((w) => w.resolve({ status: 'interrupted', reason: 'superseded' }));
    stopChromeKeepAlive();
    activeUtterance = null;
    try {
      window.speechSynthesis?.cancel();
    } catch {
      // ignore
    }
  }

  return new Promise<VoiceSpeakResult>((resolve) => {
    queue.push({ text, opts, resolve });
    void drainQueue();
  });
}

/** Compatibility wrapper — resolves `started` when speech begins; still holds utterance until end. */
export async function speakNexoraReliable(
  text: string,
  opts: VoiceSpeakOptions & { muted?: boolean; onStart?: () => void; onEnd?: () => void; onError?: (r: string) => void } = {}
): Promise<{ status: VoiceSpeakStatus; reason?: string }> {
  if (opts.muted) return { status: 'muted' };

  let started = false;
  const result = await speakJarvis(text, {
    ...opts,
    interrupt: true,
    onStart: () => {
      started = true;
      opts.onStart?.();
    },
    onEnd: opts.onEnd,
    onError: opts.onError,
  });

  // Legacy callers treated "started" as success for greeting marks.
  if (result.status === 'completed') return { status: 'started', reason: result.reason };
  if (result.status === 'blocked' || result.status === 'unsupported' || result.status === 'error' || result.status === 'empty' || result.status === 'muted' || result.status === 'interrupted') {
    return result;
  }
  return started ? { status: 'started' } : result;
}

export async function enableAndSpeak(
  text: string,
  opts: VoiceSpeakOptions = {}
): Promise<VoiceSpeakResult> {
  if (!canUseSpeechSynthesis()) return { status: 'unsupported' };
  try {
    // User-gesture unlock — do not leave a warm utterance playing
    window.speechSynthesis.cancel();
    const warm = new SpeechSynthesisUtterance('');
    warm.volume = 0;
    // Some browsers reject empty string — use a zero-volume period
    warm.text = '.';
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

/** Test helper — reset module state */
export function __resetJarvisVoiceForTests(): void {
  interruptJarvisVoice();
  muted = false;
  cachedVoices = null;
  queue = [];
  draining = false;
}
