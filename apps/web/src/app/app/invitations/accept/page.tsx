'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { inviteAcceptPath } from '@/lib/routes';

/** Legacy accept URL → canonical /invite/[token] */
function RedirectInner() {
  const router = useRouter();
  const search = useSearchParams();
  const token = (search.get('token') || '').trim();

  useEffect(() => {
    if (token) router.replace(inviteAcceptPath(token));
    else router.replace('/app/settings/workspace');
  }, [token, router]);

  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm text-neutral-400">
      Opening invitation…
    </div>
  );
}

export default function LegacyInvitationAcceptPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-neutral-400">Opening invitation…</div>}>
      <RedirectInner />
    </Suspense>
  );
}
