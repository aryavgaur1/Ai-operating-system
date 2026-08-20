/**
 * Wake-phrase helpers for Jarvis. Recognition itself is owned by JarvisProvider
 * and only runs after the user enables voice mode.
 */

const WAKE_RE =
  /\b(?:hey|hi|hello|ok|okay)\s+nexora\b|\bnexora\b(?=\s*[,.]?\s*(?:find|show|check|open|create|draft|summarize|what|who|where|how))/i;

export function matchesWakePhrase(transcript: string): boolean {
  const t = (transcript || '').trim();
  if (!t) return false;
  return WAKE_RE.test(t) || /^(?:hey|hi|hello)\s+nexora\b/i.test(t);
}

/** Strip leading wake phrase so the remainder can be executed as the command. */
export function stripWakePhrase(transcript: string): string {
  const t = (transcript || '').trim();
  return t
    .replace(/^(?:hey|hi|hello|ok|okay)[,.]?\s+nexora[,.]?\s*/i, '')
    .replace(/^nexora[,.]?\s*/i, '')
    .trim();
}

export function isStopCommand(transcript: string): boolean {
  return /^(stop|cancel|quiet|silence|shut up)[.!]?$/i.test((transcript || '').trim());
}
