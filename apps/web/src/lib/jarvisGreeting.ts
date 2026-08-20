/**
 * Pure Jarvis greeting helpers — no React, no DOM side effects beyond optional storage adapters.
 * Used by the authenticated shell and by unit tests.
 */

export type DayPart = 'morning' | 'afternoon' | 'evening';

export type GreetingInput = {
  displayName: string | null | undefined;
  /** Local hour 0–23. Defaults to caller's clock when omitted. */
  hour?: number;
  workspaceName?: string | null;
};

export type BuiltGreeting = {
  dayPart: DayPart;
  firstName: string | null;
  spokenText: string;
  headline: string;
  subline: string;
};

export const JARVIS_SUGGESTIONS = [
  { id: 'priority-email', label: 'Find important emails', prompt: 'Find my top priority emails.' },
  { id: 'pending-work', label: 'Show pending work', prompt: 'Show my pending approvals and what needs attention.' },
  { id: 'continue', label: 'Continue where I left off', prompt: 'What was I working on last? Summarize the latest conversation.' },
  { id: 'important-today', label: "What's important today?", prompt: "What's important for me today across email and approvals?" },
] as const;

export const PENDING_PROMPT_KEY = 'nexora.jarvis.pendingPrompt';
export const GREETING_SESSION_KEY = 'nexora.jarvis.sessionGreeting';

export function dayPartFromHour(hour: number): DayPart {
  const h = ((hour % 24) + 24) % 24;
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

/** First name from display name — never invents a placeholder person. */
export function firstNameFromDisplayName(displayName: string | null | undefined): string | null {
  const raw = (displayName || '').trim();
  if (!raw) return null;
  // Prefer given name before email-like strings
  if (raw.includes('@')) {
    const local = raw.split('@')[0]?.replace(/[._-]+/g, ' ').trim();
    const part = local?.split(/\s+/)[0];
    return part && part.length > 1 ? capitalize(part) : null;
  }
  const part = raw.split(/\s+/)[0];
  if (!part || part.length < 2) return null;
  // Reject generic labels
  if (/^(user|admin|member|guest|test)$/i.test(part)) return null;
  return capitalize(part);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function buildJarvisGreeting(input: GreetingInput, now = new Date()): BuiltGreeting {
  const hour = typeof input.hour === 'number' ? input.hour : now.getHours();
  const dayPart = dayPartFromHour(hour);
  const firstName = firstNameFromDisplayName(input.displayName);

  const salutation =
    dayPart === 'morning' ? 'Good morning' : dayPart === 'afternoon' ? 'Good afternoon' : 'Good evening';

  const spokenText = firstName
    ? dayPart === 'morning'
      ? `${salutation}, ${firstName}. I'm Nexora. How can I help you today?`
      : dayPart === 'afternoon'
        ? `${salutation}, ${firstName}. I'm Nexora. What would you like me to take care of?`
        : `${salutation}, ${firstName}. I'm Nexora. What can I help you with?`
    : dayPart === 'morning'
      ? `${salutation}. I'm Nexora. How can I help you today?`
      : dayPart === 'afternoon'
        ? `${salutation}. I'm Nexora. What would you like me to take care of?`
        : `${salutation}. I'm Nexora. What can I help you with?`;

  const headline = firstName ? `${salutation}, ${firstName}.` : `${salutation}.`;
  const subline = "I'm Nexora. How can I help you today?";

  return { dayPart, firstName, spokenText, headline, subline };
}

export type GreetingSessionRecord = {
  userId: string;
  /** Text was presented this browser session */
  presented: boolean;
  /** SpeechSynthesis actually started (onstart) this session */
  spoken: boolean;
};

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export function readGreetingSession(storage: StorageLike | null | undefined): GreetingSessionRecord | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(GREETING_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GreetingSessionRecord;
    if (!parsed || typeof parsed.userId !== 'string') return null;
    return {
      userId: parsed.userId,
      presented: Boolean(parsed.presented),
      spoken: Boolean(parsed.spoken),
    };
  } catch {
    return null;
  }
}

export function writeGreetingSession(storage: StorageLike | null | undefined, record: GreetingSessionRecord): void {
  if (!storage) return;
  try {
    storage.setItem(GREETING_SESSION_KEY, JSON.stringify(record));
  } catch {
    // ignore quota / private mode
  }
}

export function clearGreetingSession(storage: StorageLike | null | undefined): void {
  if (!storage) return;
  try {
    storage.removeItem(GREETING_SESSION_KEY);
    storage.removeItem(PENDING_PROMPT_KEY);
  } catch {
    // ignore
  }
}

/** In-memory auto-speak attempts — survives React remounts; cleared on logout. */
const autoSpeakAttemptedForUser = new Set<string>();

export function hasAutoSpeakAttempted(userId: string): boolean {
  return autoSpeakAttemptedForUser.has(userId);
}

export function markAutoSpeakAttempted(userId: string): void {
  autoSpeakAttemptedForUser.add(userId);
}

export function clearAutoSpeakAttempts(): void {
  autoSpeakAttemptedForUser.clear();
}

/**
 * Decide whether Jarvis should run the greeting flow for this user in this browser session.
 * Workspace switches must NOT re-greet when the same user already presented.
 */
export function shouldPresentGreeting(
  userId: string | null | undefined,
  storage: StorageLike | null | undefined
): boolean {
  if (!userId) return false;
  const existing = readGreetingSession(storage);
  if (!existing) return true;
  if (existing.userId !== userId) return true;
  return !existing.presented;
}

export function markGreetingPresented(
  userId: string,
  storage: StorageLike | null | undefined,
  opts: { spoken?: boolean } = {}
): GreetingSessionRecord {
  const prev = readGreetingSession(storage);
  const next: GreetingSessionRecord = {
    userId,
    presented: true,
    spoken: opts.spoken ?? (prev?.userId === userId ? prev.spoken : false),
  };
  writeGreetingSession(storage, next);
  return next;
}

export function markGreetingSpoken(userId: string, storage: StorageLike | null | undefined): GreetingSessionRecord {
  const next: GreetingSessionRecord = { userId, presented: true, spoken: true };
  writeGreetingSession(storage, next);
  return next;
}

export function setPendingJarvisPrompt(storage: StorageLike | null | undefined, prompt: string): void {
  if (!storage) return;
  try {
    storage.setItem(PENDING_PROMPT_KEY, prompt);
  } catch {
    // ignore
  }
}

export function consumePendingJarvisPrompt(storage: StorageLike | null | undefined): string | null {
  if (!storage) return null;
  try {
    const v = storage.getItem(PENDING_PROMPT_KEY);
    storage.removeItem(PENDING_PROMPT_KEY);
    const t = (v || '').trim();
    return t || null;
  } catch {
    return null;
  }
}
