'use client';

import { ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { SectionHeading } from '@/components/landing/SectionHeading';

const FLOW = ['Propose', 'Approve', 'Act', 'Verify', 'Remember'];

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.25 },
  transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1] as const },
};

export function HowItWorksSection({ compact = false }: { compact?: boolean }) {
  return (
    <section className={compact ? '' : 'py-4'}>
      <SectionHeading
        eyebrow="How it works"
        title="Propose → Approve → Act."
        body="High-consequence writes pause for a human gate — then run against live Slack, Jira, Notion, and Gmail APIs."
      />
      <div className="mt-12 flex flex-wrap items-center justify-center gap-2 sm:gap-3">
        {FLOW.map((step, i) => (
          <motion.div key={step} {...fadeUp} className="flex items-center gap-2 sm:gap-3">
            <motion.div
              className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/10 to-transparent px-5 py-4 text-center"
              animate={{
                borderColor: ['rgba(255,255,255,0.1)', 'rgba(91,157,255,0.45)', 'rgba(255,255,255,0.1)'],
                boxShadow: [
                  '0 0 0 rgba(91,157,255,0)',
                  '0 0 24px rgba(91,157,255,0.18)',
                  '0 0 0 rgba(91,157,255,0)',
                ],
              }}
              transition={{ duration: 3.6, repeat: Infinity, delay: i * 0.55, ease: 'easeInOut' }}
            >
              <div className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">0{i + 1}</div>
              <div className="font-display mt-1 text-lg text-white">{step}</div>
            </motion.div>
            {i < FLOW.length - 1 && (
              <span className="relative hidden h-8 w-10 items-center justify-center sm:flex">
                <motion.span className="absolute inset-y-0 left-0 w-full overflow-hidden" aria-hidden>
                  <motion.span
                    className="absolute top-1/2 h-[2px] w-full -translate-y-1/2 bg-gradient-to-r from-transparent via-accent to-transparent"
                    animate={{ x: ['-100%', '100%'] }}
                    transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.55, ease: 'easeInOut' }}
                  />
                </motion.span>
                <motion.span
                  animate={{ x: [0, 6, 0], opacity: [0.4, 1, 0.4] }}
                  transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.55, ease: 'easeInOut' }}
                >
                  <ArrowRight className="text-accent" size={16} />
                </motion.span>
              </span>
            )}
          </motion.div>
        ))}
      </div>
      {!compact && (
        <div className="mx-auto mt-14 grid max-w-4xl gap-4 sm:grid-cols-3">
          {[
            ['Understand', 'Natural language intent is classified and routed to the right connector family.'],
            ['Authorize', 'High-impact actions show intent, impact, and wait for Approve & run.'],
            ['Verify', 'Results are checked against the external API — with real resource links.'],
          ].map(([title, copy]) => (
            <div key={title} className="rounded-2xl border border-white/8 bg-white/[0.03] p-5">
              <div className="font-display text-lg text-white">{title}</div>
              <p className="mt-2 text-sm leading-7 text-neutral-400">{copy}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
