'use client';

import { useParams } from 'next/navigation';
import { ChatWorkspace } from '@/components/ChatWorkspace';

/** URL-stable conversation — /app/chat/:conversationId */
export default function ChatConversationPage() {
  const params = useParams();
  const id = typeof params?.conversationId === 'string' ? params.conversationId : undefined;
  return <ChatWorkspace routeConversationId={id} />;
}
