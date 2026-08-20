/**
 * Wake-phrase helpers for Jarvis. Recognition is owned by JarvisProvider
 * and only runs after explicit user enablement (or click-to-talk).
 */

const WAKE_RE =
  /\b(?:hey|hi|hello|ok|okay)\s+(?:jarvis|nexora)\b|\b(?:jarvis|nexora)\b(?=\s*[,.]?\s*(?:find|show|check|open|create|draft|summarize|what|who|where|how|can|please))/i;

export function matchesWakePhrase(transcript: string): boolean {
  const t = (transcript || '').trim();
  if (!t) return false;
  return WAKE_RE.test(t) || /^(?:hey|hi|hello)\s+(?:jarvis|nexora)\b/i.test(t);
}

/** True when the utterance is ONLY a wake (no follow-on command). */
export function isWakeOnly(transcript: string): boolean {
  const t = (transcript || '').trim();
  return /^(?:hey|hi|hello|ok|okay)[,.]?\s+(?:jarvis|nexora)[.!?]*$/i.test(t);
}

/** Strip leading wake phrase so the remainder can be executed as the command. */
export function stripWakePhrase(transcript: string): string {
  const t = (transcript || '').trim();
  return t
    .replace(/^(?:hey|hi|hello|ok|okay)[,.]?\s+(?:jarvis|nexora)[,.]?\s*/i, '')
    .replace(/^(?:jarvis|nexora)[,.]?\s*/i, '')
    .trim();
}

export function isStopCommand(transcript: string): boolean {
  return /^(stop|cancel|quiet|silence|shut up)(?:\s+speaking)?[.!]?$/i.test((transcript || '').trim());
}
