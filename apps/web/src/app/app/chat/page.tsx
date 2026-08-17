'use client';

import { ChatWorkspace } from '@/components/ChatWorkspace';

/** Empty chat workspace — first message creates a durable conversation and navigates to /app/chat/:id */
export default function ChatPage() {
  return <ChatWorkspace />;
}
