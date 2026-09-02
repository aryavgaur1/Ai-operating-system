'use client';

import { Suspense } from 'react';
import { ConnectionsCenter } from '@/components/connections/ConnectionsCenter';

export default function IntegrationsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-neutral-500">Loading connections…</p>}>
      <ConnectionsCenter />
    </Suspense>
  );
}
