/**
 * Shared Jarvis turn runner — one assistant pipeline for floating layer + chat.
 * Does not own React state; callers map stream events to UI.
 */

import { api, type AgentTurnResult, type ChatStreamEvent } from '@/lib/api';
import { writeActiveConversationHint } from '@/lib/activeConversation';
import { readCachedConversationId } from '@/lib/routes';

export type JarvisTurnHandlers = {
  onEvent: (event: ChatStreamEvent) => void;
  signal?: AbortSignal;
  /** Prefer an explicit conversation; falls back to cached active id. */
  conversationId?: string | null;
  attachmentIds?: string[];
  /** Create a conversation if none exists (default true). */
  ensureConversation?: boolean;
};

export type JarvisTurnResult = {
  result: AgentTurnResult | null;
  conversationId: string | undefined;
};

export async function runJarvisTurn(message: string, handlers: JarvisTurnHandlers): Promise<JarvisTurnResult> {
  const trimmed = message.trim();
  if (!trimmed) return { result: null, conversationId: handlers.conversationId || undefined };

  let conversationId =
    (handlers.conversationId && handlers.conversationId.trim()) || readCachedConversationId() || undefined;

  if (!conversationId && handlers.ensureConversation !== false) {
    const created = await api.createConversation(trimmed.slice(0, 80));
    conversationId = created.conversation.id;
    writeActiveConversationHint(conversationId);
  }

  if (conversationId) writeActiveConversationHint(conversationId);

  const result = await api.streamMessage(trimmed, {
    conversationId,
    attachmentIds: handlers.attachmentIds,
    signal: handlers.signal,
    onEvent: (event) => {
      if (event.type === 'conversation') {
        conversationId = event.conversationId;
        writeActiveConversationHint(event.conversationId);
      }
      if (event.type === 'done' && event.result.conversationId) {
        conversationId = event.result.conversationId;
        writeActiveConversationHint(event.result.conversationId);
      }
      handlers.onEvent(event);
    },
  });

  const finalId = result?.conversationId || conversationId;
  if (finalId) writeActiveConversationHint(finalId);
  return { result, conversationId: finalId };
}
