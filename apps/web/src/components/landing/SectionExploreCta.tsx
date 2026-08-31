import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

/** Subtle CTA below a homepage section — links to the dedicated page without changing section layout. */
export function SectionExploreCta({ href, label }: { href: string; label: string }) {
  return (
    <div className="mt-8 flex justify-center">
      <Link
        href={href}
        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-5 py-2.5 text-sm text-neutral-200 transition hover:border-accent/30 hover:text-white"
      >
        {label}
        <ArrowRight size={14} className="text-accent" />
      </Link>
    </div>
  );
}
