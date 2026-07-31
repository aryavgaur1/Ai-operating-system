'use client';

import { Suspense } from 'react';
import LoginInner from './LoginInner';

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-neutral-400">Loading…</div>}>
      <LoginInner />
    </Suspense>
  );
}
