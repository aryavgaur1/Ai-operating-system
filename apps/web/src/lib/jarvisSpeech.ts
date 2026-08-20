/**
 * Reliable browser TTS for Nexora Jarvis.
 * Prefer a natural male English voice. Detect autoplay blocks honestly.
 */

import { speakableText, canUseSpeechSynthesis } from '@/components/NexoraPresence';

export type SpeakStatus = 'started' | 'blocked' | 'muted' | 'unsupported' | 'error' | 'empty';

export type SpeakOutcome = {
  status: SpeakStatus;
  reason?: string;
};

export type SpeakOptions = {
  muted?: boolean;
  /** Prefer male voice when available */
  preferMale?: boolean;
  lang?: string;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (reason: string) => void;
  /** How long to wait for speech to actually begin (ms) */
  startTimeoutMs?: number;
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function ensureSpeechVoices(timeoutMs = 800): Promise<SpeechSynthesisVoice[]> {
  if (!canUseSpeechSynthesis()) return [];
  const existing = window.speechSynthesis.getVoices();
  if (existing.length > 0) return existing;

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.speechSynthesis.removeEventListener('voiceschanged', onChange);
      resolve(window.speechSynthesis.getVoices());
    };
    const onChange = () => finish();
    window.speechSynthesis.addEventListener('voiceschanged', onChange);
    window.setTimeout(finish, timeoutMs);
  });
}

/** Pick a calm male English voice when the browser exposes one. */
export function pickMaleVoice(voices: SpeechSynthesisVoice[], lang = 'en'): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const langRe = new RegExp(`^${lang}`, 'i');
  const en = voices.filter((v) => langRe.test(v.lang) || /^en/i.test(v.lang));
  const pool = en.length ? en : voices;

  const preferredName =
    /daniel|alex|david|james|mark|fred|ravi|thomas|google uk english male|microsoft david|microsoft mark|microsoft guy|english male/i;

  const byName = pool.find((v) => preferredName.test(v.name));
  if (byName) return byName;

  const explicitMale = pool.find((v) => /male/i.test(v.name) && !/female/i.test(v.name));
  if (explicitMale) return explicitMale;

  // Common system defaults that sound male on macOS/Windows
  const system = pool.find((v) => /^(Alex|Daniel|David|Fred|Microsoft David|Google US English)$/i.test(v.name));
  if (system) return system;

  return pool.find((v) => /^en-US/i.test(v.lang)) || pool[0] || null;
}

/**
 * Speak text and only resolve `started` after SpeechSynthesisUtterance.onstart.
 * If the browser blocks autoplay, resolves `blocked` instead of lying.
 */
export async function speakNexoraReliable(text: string, opts: SpeakOptions = {}): Promise<SpeakOutcome> {
  if (opts.muted) return { status: 'muted' };
  if (!canUseSpeechSynthesis()) return { status: 'unsupported', reason: 'Speech synthesis is not available in this browser.' };

  const clean = speakableText(text);
  if (!clean) return { status: 'empty' };

  const voices = await ensureSpeechVoices();
  const voice = opts.preferMale === false ? null : pickMaleVoice(voices, opts.lang || 'en');
  const startTimeoutMs = opts.startTimeoutMs ?? 1200;

  try {
    window.speechSynthesis.cancel();
    // Chrome sometimes needs a tick after cancel before the next speak works.
    await wait(30);

    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.rate = 1.0;
    utterance.pitch = 0.95;
    utterance.lang = opts.lang || voice?.lang || 'en-US';
    if (voice) utterance.voice = voice;

    return await new Promise<SpeakOutcome>((resolve) => {
      let settled = false;
      const settle = (outcome: SpeakOutcome) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(outcome);
      };

      utterance.onstart = () => {
        opts.onStart?.();
        settle({ status: 'started' });
      };
      utterance.onend = () => {
        opts.onEnd?.();
      };
      utterance.onerror = (event) => {
        const reason = String((event as SpeechSynthesisErrorEvent).error || 'speech_error');
        if (reason === 'canceled' || reason === 'interrupted') {
          // Cancelled by us / newer speech — not a hard failure for greeting start detection.
          settle({ status: 'blocked', reason });
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

      const timer = window.setTimeout(() => {
        // If onstart never fired, treat as autoplay block (common without a user gesture).
        const speaking = window.speechSynthesis.speaking || window.speechSynthesis.pending;
        if (!speaking) {
          try {
            window.speechSynthesis.cancel();
          } catch {
            // ignore
          }
          settle({
            status: 'blocked',
            reason: 'Browser blocked automatic speech. Click Enable Jarvis voice to hear the greeting.',
          });
        }
      }, startTimeoutMs);

      try {
        window.speechSynthesis.speak(utterance);
        // Safari quirk: resume if paused
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
    return {
      status: 'error',
      reason: err instanceof Error ? err.message : 'speak_failed',
    };
  }
}

/** Unlock / resume synthesis from a user gesture, then speak. */
export async function enableAndSpeak(text: string, opts: SpeakOptions = {}): Promise<SpeakOutcome> {
  if (!canUseSpeechSynthesis()) return { status: 'unsupported' };
  try {
    // Tiny unlock utterance discarded — helps some browsers after autoplay block.
    window.speechSynthesis.cancel();
    const warm = new SpeechSynthesisUtterance(' ');
    warm.volume = 0;
    window.speechSynthesis.speak(warm);
    window.speechSynthesis.cancel();
  } catch {
    // ignore unlock failures
  }
  return speakNexoraReliable(text, { ...opts, preferMale: opts.preferMale !== false });
}
