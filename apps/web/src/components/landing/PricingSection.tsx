'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { REGISTER } from '@/lib/routes';
import { cn } from '@/lib/utils';

const FREE_INCLUDED = [
  'Core chat',
  'Connect Slack, Jira, and Notion yourself',
  'Propose → approve → act for normal work',
  'Chat history that persists in your workspace',
];

const ADVANCED_DIFFS = [
  {
    capability: 'Seats and roles',
    free: 'One workspace you run yourself',
    advanced: 'Seats, roles, and shared workspaces',
  },
  {
    capability: 'Audit',
    free: 'Approvals stay in the product',
    advanced: 'Audit log export',
  },
  {
    capability: 'Identity',
    free: 'Standard sign-in',
    advanced: 'SSO / SAML',
  },
  {
    capability: 'Operations',
    free: 'Standard availability',
    advanced: 'Custom SLAs and private deployment options',
  },
];

export function PricingSection({ heading = true }: { heading?: boolean }) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <div>
      {heading && (
        <div className="mx-auto max-w-3xl text-center">
          <div className="text-sm font-medium text-accent2">Pricing</div>
          <h2 className="font-display mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl md:text-5xl">
            First 365 days are free
          </h2>
          <p className="mt-4 text-sm leading-7 text-neutral-400 sm:text-base">
            Use Nexora for core chat, live connectors, and human-gated actions. Advanced is for teams that need seats, export, and extra governance.
          </p>
        </div>
      )}

      <div className={cn('mx-auto max-w-2xl', heading && 'mt-10')}>
        <article className="rounded-2xl border border-white/10 bg-[#0b1220] p-8 sm:p-10">
          <p className="text-sm text-neutral-400">Free</p>
          <p className="font-display mt-2 text-4xl tracking-tight text-white sm:text-5xl">365 days</p>
          <p className="mt-3 text-sm leading-6 text-neutral-400">
            No monthly or yearly plan grid. Start on the OS, connect your tools, and approve real work.
          </p>
          <ul className="mt-6 space-y-2 text-sm text-neutral-300">
            {FREE_INCLUDED.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span className="mt-[0.55rem] h-1 w-1 shrink-0 rounded-full bg-accent" />
                {item}
              </li>
            ))}
          </ul>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href={REGISTER}
              className="inline-flex items-center justify-center rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-[#04101f]"
            >
              Start free
            </Link>
            <Link
              href={REGISTER}
              className="inline-flex items-center justify-center rounded-full border border-white/15 px-5 py-2.5 text-sm text-white hover:bg-white/5"
            >
              Get started
            </Link>
          </div>
        </article>

        <div className="mt-4 rounded-2xl border border-white/10 bg-[#0b1220]">
          <button
            type="button"
            className="flex w-full items-center justify-between px-6 py-5 text-left sm:px-8"
            onClick={() => setAdvancedOpen((open) => !open)}
            aria-expanded={advancedOpen}
          >
            <span>
              <span className="block text-sm text-white">Advanced</span>
              <span className="mt-1 block text-sm text-neutral-500">
                Paid upgrade for seats, audit, SSO, and private deploy
              </span>
            </span>
            <ChevronDown
              size={16}
              className={cn('shrink-0 text-neutral-500 transition', advancedOpen && 'rotate-180')}
            />
          </button>
          <AnimatePresence initial={false}>
            {advancedOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="border-t border-white/8 px-6 pb-8 pt-2 sm:px-8">
                  <p className="text-sm leading-6 text-neutral-400">
                    These are the capabilities that differ. Free covers normal work; Advanced is for team governance.
                  </p>
                  <ul className="mt-5 space-y-4">
                    {ADVANCED_DIFFS.map((row) => (
                      <li key={row.capability} className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
                        <div className="text-sm text-white">{row.capability}</div>
                        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                          <p className="text-neutral-500">
                            <span className="text-neutral-400">Free. </span>
                            {row.free}
                          </p>
                          <p className="text-neutral-300">
                            <span className="text-accent2">Advanced. </span>
                            {row.advanced}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <Link
                    href="/contact"
                    className="mt-6 inline-flex text-sm text-neutral-400 underline-offset-4 hover:text-white hover:underline"
                  >
                    Talk to us
                  </Link>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
