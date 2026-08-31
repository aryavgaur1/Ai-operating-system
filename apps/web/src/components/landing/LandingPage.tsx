'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AnimatePresence, motion, useScroll, useTransform } from 'framer-motion';
import {
  ArrowRight,
  ChevronDown,
  Fingerprint,
  Globe2,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { GlobalNetwork } from '@/components/landing/GlobalNetwork';
import { LiveSparkGraphs } from '@/components/landing/LiveSparkGraphs';
import { CapabilityBento } from '@/components/landing/CapabilityBento';
import { IntegrationAccordion, LANDING_TOOLS } from '@/components/landing/IntegrationAccordion';
import { SmoothScroll } from '@/components/landing/SmoothScroll';
import { MarketingNav } from '@/components/landing/MarketingNav';
import { MarketingFooter } from '@/components/landing/MarketingFooter';
import { MarketingExploreCards } from '@/components/landing/MarketingExploreCards';
import { SectionHeading } from '@/components/landing/SectionHeading';
import { TestimonialsSlider } from '@/components/landing/TestimonialsSlider';
import { HowItWorksSection } from '@/components/landing/HowItWorksSection';
import { ChatAssistant } from '@/components/landing/ChatAssistant';
import { FounderDesk } from '@/components/landing/FounderDesk';
import { cn } from '@/lib/utils';

const INTEGRATIONS = LANDING_TOOLS.map((t) => t.name);

const FAQS = [
  ['What is Nexora?', 'Nexora is a Work Action OS: it proposes real actions in Slack, Jira, Notion, and Gmail, then pauses for a human gate before it acts.'],
  ['How does Propose → Approve → Act work?', 'Nexora classifies intent, plans tool calls, and queues high-consequence writes for Approve & run.'],
  ['Which integrations are live?', 'Slack, Jira, Notion, and Gmail run live today via OAuth-connected workspaces.'],
];

export function LandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const { scrollYProgress } = useScroll();
  const heroOpacity = useTransform(scrollYProgress, [0, 0.12], [1, 0.35]);

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#05060a] text-white">
      <SmoothScroll />
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(91,157,255,0.14),transparent_55%)]" />
        <div className="absolute -left-24 top-40 h-80 w-80 animate-floatSlow rounded-full bg-accent/20 blur-[100px]" />
        <div className="absolute -right-20 top-24 h-96 w-96 animate-floatSlower rounded-full bg-accent2/10 blur-[110px]" />
        <div className="absolute inset-0 bg-noise opacity-40" />
      </div>

      <MarketingNav />

      <section className="relative mx-auto max-w-7xl px-4 pb-16 pt-28 sm:px-6 sm:pt-32">
        <motion.div style={{ opacity: heroOpacity }} className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] uppercase tracking-[0.22em] text-neutral-300"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-accent2" /> Nexora OS · AI Operating System
            </motion.div>
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="font-display mt-5 text-4xl font-semibold leading-[1.05] tracking-tight text-white sm:text-5xl md:text-6xl lg:text-[4.1rem]"
            >
              <span className="gradient-text">Propose → Approve → Act</span>
              <span className="block text-[0.72em] font-medium text-neutral-200 sm:text-[0.68em] md:mt-2">
                across Slack, Jira, Notion, and Gmail.
              </span>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.22 }}
              className="mt-5 max-w-xl text-base leading-8 text-neutral-400 sm:text-lg"
            >
              Nexora is the Work Action OS with a human gate — it plans real writes, waits for your approval, and
              executes against live APIs.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.28 }}
              className="mt-8 flex flex-wrap gap-3"
            >
              <Link href="/register" className="inline-flex items-center gap-2 rounded-full bg-accent px-6 py-3 text-sm font-semibold text-[#04101f]">
                Start Free <ArrowRight size={16} />
              </Link>
              <Link href="/contact" className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-6 py-3 text-sm text-white">
                Book Demo
              </Link>
            </motion.div>
          </div>
          <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.2 }}>
            <GlobalNetwork />
          </motion.div>
        </motion.div>
        <div className="mt-14">
          <LiveSparkGraphs />
        </div>
      </section>

      <section className="border-y border-white/5 py-10">
        <div className="mx-auto max-w-7xl px-4 text-center text-[11px] uppercase tracking-[0.28em] text-neutral-500 sm:px-6">
          Trusted integrations
        </div>
        <div className="mt-6 overflow-hidden">
          <div className="flex w-max animate-marquee gap-3 whitespace-nowrap px-4 hover:[animation-play-state:paused]">
            {[...INTEGRATIONS, ...INTEGRATIONS].map((name, i) => (
              <span
                key={`${name}-${i}`}
                className="inline-flex shrink-0 items-center rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-neutral-300"
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <SectionHeading
          eyebrow="Platform"
          title="Everything you need. Nothing you don't."
          body="Global sync and lightning-fast execution — the OS layer that keeps every tool aligned."
        />
        <div className="mt-12">
          <CapabilityBento />
        </div>
      </section>

      <MarketingExploreCards />

      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <HowItWorksSection compact />
        <div className="mt-8 text-center">
          <Link href="/how-it-works" className="inline-flex items-center gap-2 text-sm text-accent hover:text-white">
            Full walkthrough <ArrowRight size={14} />
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <SectionHeading
          eyebrow="Integrations preview"
          title="Connect the tools you already use."
          body="Slack, Jira, Notion, and Gmail run live today."
        />
        <div className="mt-10">
          <IntegrationAccordion />
        </div>
        <div className="mt-8 text-center">
          <Link href="/integrations" className="inline-flex items-center gap-2 text-sm text-accent hover:text-white">
            All integrations <ArrowRight size={14} />
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <SectionHeading eyebrow="Testimonials" title="Built for operators who ship." />
        <TestimonialsSlider />
      </section>

      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <SectionHeading eyebrow="FAQ" title="Questions, answered." />
        <div className="mt-10 space-y-2">
          {FAQS.map(([q, a], i) => (
            <div key={q} className="rounded-2xl border border-white/8 bg-white/[0.03]">
              <button
                type="button"
                className="flex w-full items-center justify-between px-4 py-4 text-left text-sm text-white"
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
              >
                {q}
                <ChevronDown size={16} className={cn('text-neutral-500 transition', openFaq === i && 'rotate-180')} />
              </button>
              <AnimatePresence>
                {openFaq === i && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden px-4 pb-4 text-sm leading-7 text-neutral-400"
                  >
                    {a}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
        <div className="mt-6 text-center">
          <Link href="/docs" className="text-sm text-accent hover:text-white">
            Read documentation →
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-24 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="relative overflow-hidden rounded-[36px] border border-white/10 bg-gradient-to-br from-accent/20 via-[#0b1220] to-accent2/10 px-8 py-16 text-center"
        >
          <Globe2 className="mx-auto text-accent" size={28} />
          <h2 className="font-display mt-5 text-3xl font-semibold text-white sm:text-5xl">Ready to run work with a human gate?</h2>
          <p className="mx-auto mt-4 max-w-xl text-neutral-400">
            Start free, connect Slack · Jira · Notion · Gmail, and Approve & run real actions from one surface.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/register" className="rounded-full bg-accent px-6 py-3 text-sm font-semibold text-[#04101f]">
              Start Free
            </Link>
            <Link href="/pricing" className="rounded-full border border-white/15 px-6 py-3 text-sm text-white">
              View pricing
            </Link>
          </div>
          <div className="mt-8 flex flex-wrap justify-center gap-4 text-xs text-neutral-500">
            <span className="inline-flex items-center gap-1">
              <ShieldCheck size={12} /> SOC2-ready posture
            </span>
            <span className="inline-flex items-center gap-1">
              <Fingerprint size={12} /> Encrypted tokens
            </span>
            <span className="inline-flex items-center gap-1">
              <Sparkles size={12} /> Live Slack · Jira · Notion · Gmail
            </span>
          </div>
        </motion.div>
      </section>

      <FounderDesk />
      <MarketingFooter />
      <ChatAssistant />
    </div>
  );
}
