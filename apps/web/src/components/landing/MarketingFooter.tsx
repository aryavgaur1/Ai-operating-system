import Link from 'next/link';
import { NexoraLockup } from '@/components/NexoraMark';
import { MARKETING_FOOTER } from '@/lib/marketingNav';

export function MarketingFooter() {
  return (
    <footer className="border-t border-white/5 py-14">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 md:grid-cols-4">
        <div>
          <NexoraLockup />
          <p className="mt-3 text-sm text-neutral-500">Work Action OS — Propose → Approve → Act.</p>
        </div>
        {MARKETING_FOOTER.map((col) => (
          <div key={col.title}>
            <div className="text-xs font-medium text-neutral-500">{col.title}</div>
            <ul className="mt-4 space-y-2 text-sm text-neutral-400">
              {col.links.map((l) => (
                <li key={`${col.title}-${l.label}`}>
                  <Link href={l.href} className="hover:text-white">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto mt-10 max-w-7xl px-4 text-xs text-neutral-600 sm:px-6" suppressHydrationWarning>
        © {new Date().getFullYear()} Nexora OS
      </div>
    </footer>
  );
}
