'use client';

import Link from 'next/link';
import { APP_HOME } from '@/lib/routes';

export function ComingSoon({ title, body }: { title: string; body?: string }) {
  return (
    <div className="glass mx-auto max-w-lg rounded-[28px] p-8 text-center">
      <div className="text-[11px] uppercase tracking-[0.24em] text-neutral-500">Workspace</div>
      <h1 className="font-display mt-3 text-2xl font-semibold text-white">{title}</h1>
      <p className="mt-3 text-sm leading-7 text-neutral-400">
        {body ?? 'This surface is reserved for a future release. Your current tools remain available from the dashboard.'}
      </p>
      <Link
        href={APP_HOME}
        className="mt-6 inline-flex rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-[#04101f]"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
