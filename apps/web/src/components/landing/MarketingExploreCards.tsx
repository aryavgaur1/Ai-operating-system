'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { MARKETING_EXPLORE_CARDS } from '@/lib/marketingNav';
import { SectionHeading } from '@/components/landing/SectionHeading';

export function MarketingExploreCards() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
      <SectionHeading
        eyebrow="Explore Nexora"
        title="One OS. Dedicated pages for every pillar."
        body="Dive into how Nexora works, what agents do, how analytics surface outcomes, and which integrations are live."
      />
      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        {MARKETING_EXPLORE_CARDS.map((card, i) => (
          <motion.div
            key={card.href}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.06 }}
          >
            <Link
              href={card.href}
              className="group flex h-full flex-col rounded-[28px] border border-white/10 bg-white/[0.03] p-6 transition hover:border-accent/35 hover:bg-accent/5"
            >
              <div className="text-[11px] uppercase tracking-[0.24em] text-accent2">{card.eyebrow}</div>
              <h3 className="font-display mt-3 text-2xl font-semibold text-white">{card.title}</h3>
              <p className="mt-3 flex-1 text-sm leading-7 text-neutral-400">{card.body}</p>
              <span className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-accent group-hover:text-white">
                Learn more <ArrowRight size={14} />
              </span>
            </Link>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
