'use client';

import { usePathname } from 'next/navigation';
import { ChatWorkspace } from '@/components/ChatWorkspace';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Chat layout owns ChatWorkspace so navigating between /app/chat and
 * /app/chat/:id does NOT remount the workspace (layouts persist in App Router).
 * That eliminates the mid-stream / return-navigation wipe.
 */
export default function ChatLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '';
  const match = pathname.match(/^\/app\/chat\/([^/]+)\/?$/);
  const raw = match?.[1] ? decodeURIComponent(match[1]) : undefined;
  const routeConversationId = raw && UUID_RE.test(raw) ? raw : undefined;

  return (
    <>
      <ChatWorkspace routeConversationId={routeConversationId} />
      {/* Route segment pages are identity-only; workspace lives here. */}
      <div className="hidden" aria-hidden>
        {children}
      </div>
    </>
  );
}
