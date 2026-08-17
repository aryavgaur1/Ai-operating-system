import { APP_ROUTES, chatConversationPath, readCachedConversationId } from '@/lib/routes';
import { api } from '@/lib/api';

const ACTIVE_HINT_KEY = 'nexora:activeConversationId';
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Hint only — never authority. */
export function writeActiveConversationHint(id: string | undefined) {
  if (typeof window === 'undefined') return;
  try {
    if (id && UUID_RE.test(id)) {
      window.localStorage.setItem(ACTIVE_HINT_KEY, id);
      window.sessionStorage.setItem(ACTIVE_HINT_KEY, id);
    } else {
      window.localStorage.removeItem(ACTIVE_HINT_KEY);
      window.sessionStorage.removeItem(ACTIVE_HINT_KEY);
    }
  } catch {
    // ignore
  }
}

/**
 * Resolve which conversation Chat navigation should open.
 * Authority: GET /conversations/resume (active → recent owned).
 * Fallbacks: browser hint → listConversations[0] (still DB-backed).
 * Never creates a conversation.
 */
export async function resolveResumeConversationId(): Promise<string | undefined> {
  try {
    const res = await api.resumeConversation();
    const id = res.conversationId?.trim();
    if (id && UUID_RE.test(id)) {
      writeActiveConversationHint(id);
      return id;
    }
  } catch {
    // fall through
  }

  const hinted = readCachedConversationId();
  if (hinted) return hinted;

  try {
    const list = await api.listConversations();
    const id = list.conversations?.[0]?.id?.trim?.() ?? list.conversations?.[0]?.id;
    if (typeof id === 'string' && UUID_RE.test(id)) {
      writeActiveConversationHint(id);
      return id;
    }
  } catch {
    // ignore
  }

  return undefined;
}

/** Async: best Chat nav target from DB (call from Nav/Rail). */
export async function resolveChatHref(): Promise<string> {
  const id = await resolveResumeConversationId();
  return id ? chatConversationPath(id) : APP_ROUTES.chat;
}

export { chatResumeHref } from '@/lib/routes';
