'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { AnimatePresence, motion, useScroll, useTransform } from 'framer-motion';
import {
  ArrowRight,
  Check,
  ChevronDown,
  Fingerprint,
  Globe2,
  Play,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { GlobalNetwork } from '@/components/landing/GlobalNetwork';
import { LiveSparkGraphs } from '@/components/landing/LiveSparkGraphs';
import { CapabilityBento } from '@/components/landing/CapabilityBento';
import { IntegrationHub } from '@/components/landing/IntegrationHub';
import { IntegrationAccordion, LANDING_TOOLS } from '@/components/landing/IntegrationAccordion';
import { AgentLivingCards } from '@/components/landing/AgentLivingCards';
import { SmoothScroll } from '@/components/landing/SmoothScroll';
import { WhyNexora } from '@/components/landing/WhyNexora';
import { MarketingNav } from '@/components/landing/MarketingNav';
import { TestimonialsSlider } from '@/components/landing/TestimonialsSlider';
import { AnalysisDashboard } from '@/components/landing/AnalysisDashboard';
import { ChatAssistant } from '@/components/landing/ChatAssistant';
import { FounderDesk } from '@/components/landing/FounderDesk';
import { SectionExploreCta } from '@/components/landing/SectionExploreCta';
import { cn } from '@/lib/utils';

const INTEGRATIONS = LANDING_TOOLS.map((t) => t.name);

const FLOW = ['Propose', 'Approve', 'Act', 'Verify', 'Remember'];

const COMMANDS = [
  'Create a Notion page called Investor Notes',
  'Create a Jira ticket to track vendor follow-up in project KAN',
  'Post "Deployment complete" to #engineering on Slack',
  'Create a Slack channel called Marketing',
  'Summarize yesterday\'s Slack discussion',
  'Create a Notion page titled Weekly Report',
  'Show history for #marketing on Slack',
  'Generate product documentation in Notion',
];

const PRICING = [
  {
    name: 'Starter',
    price: '$0',
    blurb: 'Explore the OS with core chat and live connectors you connect yourself.',
    items: ['Connect Slack, Jira & Notion', 'Chat + approvals', 'Live actions only — no fake success'],
  },
  {
    name: 'Pro',
    price: '$49',
    blurb: 'For founders running live Slack + Notion execution.',
    items: ['Live tool execution', 'Memory + history', 'Priority latency'],
    featured: true,
  },
  {
    name: 'Business',
    price: '$149',
    blurb: 'Teams that need approvals, audit, and admin controls.',
    items: ['Seats & roles', 'Audit log export', 'Shared workspaces'],
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    blurb: 'Security reviews, SSO, and dedicated success.',
    items: ['SSO / SAML', 'Custom SLAs', 'Private deployment options'],
  },
];

const FAQS = [
  ['What is Nexora?', 'Nexora is a Work Action OS: it proposes real actions in Slack, Jira, and Notion, then pauses for a human gate before it acts.'],
  ['How does Propose → Approve → Act work?', 'Nexora classifies intent, plans tool calls, and queues high-consequence writes for Approve & run — so nothing posts or creates until you confirm.'],
  ['How are integrations connected?', 'Connect Slack, Jira, and Notion under Integrations (OAuth or workspace tokens). Demo mode can also use secure .env credentials.'],
  ['Can I use my own Slack?', 'Yes — your workspace bot powers live channel posts and related actions after you approve them.'],
  ['Can I connect my own Notion?', 'Yes — pages are created in your Notion workspace after you share a parent page with the Nexora connection.'],
  ['Does Jira require approval too?', 'Yes — creating or changing issues is treated as high-consequence and waits for Approve & run.'],
  ['How secure is my data?', 'Encrypted tokens, JWT sessions, org isolation, and human approval gates for high-impact writes.'],
  ['Does Nexora remember conversations?', 'Yes — chat history and workspace preferences persist in Postgres.'],
];

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.25 },
  transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1] as const },
};

function SectionHeading({ eyebrow, title, body }: { eyebrow: string; title: string; body?: string }) {
  return (
    <motion.div {...fadeUp} className="mx-auto max-w-3xl text-center">
      <div className="text-[11px] uppercase tracking-[0.28em] text-accent2">{eyebrow}</div>
      <h2 className="font-display mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl md:text-5xl">
        {title}
      </h2>
      {body && <p className="mt-4 text-sm leading-7 text-neutral-400 sm:text-base">{body}</p>}
    </motion.div>
  );
}

export function LandingPage() {
  const [yearly, setYearly] = useState(true);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [cmdIndex, setCmdIndex] = useState(0);
  const { scrollYProgress } = useScroll();
  const heroOpacity = useTransform(scrollYProgress, [0, 0.12], [1, 0.35]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setCmdIndex((i) => (i + 1) % COMMANDS.length);
    }, 4200);
    return () => window.clearInterval(id);
  }, []);

  function onDemoCommand(e: FormEvent) {
    e.preventDefault();
    setCmdIndex((i) => (i + 1) % COMMANDS.length);
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#05060a] text-white">
      <SmoothScroll />
      {/* marketing ambient */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(91,157,255,0.14),transparent_55%)]" />
        <div className="absolute -left-24 top-40 h-80 w-80 animate-floatSlow rounded-full bg-accent/20 blur-[100px]" />
        <div className="absolute -right-20 top-24 h-96 w-96 animate-floatSlower rounded-full bg-accent2/10 blur-[110px]" />
        <div className="absolute inset-0 bg-noise opacity-40" />
      </div>

      {/* Nav — glass + scroll hide/reveal */}
      <MarketingNav />

      {/* Hero */}
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
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="font-display mt-5 text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl"
              aria-label="Nexora OS"
            >
              <span className="gradient-text">Nexora OS</span>
            </motion.p>
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="font-display mt-4 text-4xl font-semibold leading-[1.05] tracking-tight text-white sm:text-5xl md:text-6xl lg:text-[4.1rem]"
            >
              <span className="gradient-text">Propose → Approve → Act</span>
              <span className="block text-[0.72em] font-medium text-neutral-200 sm:text-[0.68em] md:mt-2">
                across Slack, Jira, and Notion.
              </span>
            </motion.h1>
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.16 }}
              id="what-nexora-does"
              className="mt-5 max-w-xl rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4 text-sm leading-7 text-neutral-300"
            >
              <p className="font-semibold text-white">What Nexora OS does</p>
              <p className="mt-2">
                Nexora OS is a productivity app with OAuth integrations. Users sign in, connect their own
                Gmail and workspace tools, then use AI chat to read email, draft replies, search Slack and
                Notion, and approve real actions before anything is sent or changed.
              </p>
            </motion.div>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.22 }}
              className="mt-5 max-w-xl text-base leading-8 text-neutral-400 sm:text-lg"
            >
              Nexora is the Work Action OS with a human gate — it plans real writes, then waits for your approval before anything lands in your tools.
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
              <Link href="/login" className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-6 py-3 text-sm text-white">
                Book Demo
              </Link>
              <a href="#commands" className="inline-flex items-center gap-2 rounded-full border border-white/10 px-6 py-3 text-sm text-neutral-300">
                <Play size={14} /> Watch Demo
              </a>
            </motion.div>
            <div className="mt-10 grid max-w-lg grid-cols-3 gap-3 text-center">
              {[
                ['Beachhead', 'Slack · Jira · Notion'],
                ['Gate', 'Human approve'],
                ['Loop', 'Propose → Act'],
              ].map(([k, v]) => (
                <div key={k} className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">{k}</div>
                  <div className="mt-1 text-xs text-neutral-200">{v}</div>
                </div>
              ))}
            </div>
          </div>
          <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.2 }}>
            <GlobalNetwork />
          </motion.div>
        </motion.div>
        <div className="mt-14">
          <LiveSparkGraphs />
        </div>
      </section>

      {/* Trusted integrations marquee */}
      <section className="border-y border-white/5 py-10">
        <div className="mx-auto max-w-7xl px-4 text-center text-[11px] uppercase tracking-[0.28em] text-neutral-500 sm:px-6">
          Trusted integrations
        </div>
        <div className="mt-6 overflow-hidden">
          <div className="flex w-max animate-marquee gap-3 whitespace-nowrap px-4 hover:[animation-play-state:paused]">
            {[...INTEGRATIONS, ...INTEGRATIONS].map((name, i) => (
              <span
                key={`${name}-${i}`}
                className="inline-flex shrink-0 cursor-default items-center rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-neutral-300 transition hover:-translate-y-0.5 hover:border-accent/40 hover:bg-accent/10 hover:text-white hover:shadow-glow"
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Global Sync + Lightning Fast */}
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <SectionHeading
          eyebrow="Platform"
          title="Everything you need. Nothing you don’t."
          body="Global sync and lightning-fast execution — the OS layer that keeps every tool aligned."
        />
        <div className="mt-12">
          <CapabilityBento />
        </div>
      </section>

      {/* Integration hub with lightning wires */}
      <section id="hub" className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <SectionHeading
          eyebrow="One intelligence layer"
          title="Your digital world, unified."
          body="Nexora sits at the center. Tools connect with live data pulses — not static links."
        />
        <div className="mt-14">
          <IntegrationHub />
        </div>
        <SectionExploreCta href="/integrations" label="Explore integrations" />
      </section>

      {/* Integrations accordion — directly after intelligence layer */}
      <section id="integrations" className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <SectionHeading
          eyebrow="Integrations"
          title="Connect the tools you already use."
          body="Hover a tool to expand it. Slack, Notion, and Jira run live today."
        />
        <div className="mt-12">
          <IntegrationAccordion />
        </div>
        <SectionExploreCta href="/integrations" label="View all integrations" />
      </section>

      {/* Agents — directly after integrations */}
      <section id="agents" className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <SectionHeading eyebrow="AI Agents" title="Specialists that share one OS." />
        <AgentLivingCards />
        <SectionExploreCta href="/ai-agents" label="Explore AI agents" />
      </section>

      {/* How it works — before Why Nexora */}
      <section id="how-it-works" className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <SectionHeading
          eyebrow="How it works"
          title="Propose → Approve → Act."
          body="High-consequence writes pause for a human gate — then run against live Slack, Jira, and Notion APIs."
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
                  <motion.span
                    className="absolute inset-y-0 left-0 w-full overflow-hidden"
                    aria-hidden
                  >
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
        <SectionExploreCta href="/how-it-works" label="See how it works" />
      </section>

      {/* Analytics — immediately after How it works */}
      <section id="analysis" className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <SectionHeading
          eyebrow="Analytics"
          title="Operator-grade visibility."
          body="Real-time metrics and intelligence for faster decisions and measurable impact."
        />
        <AnalysisDashboard />
        <SectionExploreCta href="/analytics" label="Explore analytics" />
      </section>

      {/* Why Nexora — glass stack with floating layers */}
      <section id="features" className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
        <div className="grid items-end gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8 xl:gap-12">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="max-w-xl"
          >
            <div className="text-[11px] uppercase tracking-[0.28em] text-accent2">Why Nexora</div>
            <h2 className="font-display mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl md:text-[2.75rem] md:leading-[1.1]">
              Enterprise AI, built on a foundation you can trust.
            </h2>
            <p className="mt-4 text-sm leading-7 text-neutral-400 sm:text-base">
              Nexora combines memory, reasoning, tools, and approvals into a unified system—designed for reliability,
              built for scale.
            </p>
          </motion.div>
          <div className="hidden lg:block" aria-hidden />
        </div>
        <WhyNexora />
      </section>

      {/* Live commands */}
      <section id="commands" className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <SectionHeading
          eyebrow="Live commands"
          title="Type work. Watch it execute."
          body="These are the same command patterns used in the product — mapped to real Slack and Notion APIs."
        />
        <div className="mt-12 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-3">
            {COMMANDS.map((c, i) => (
              <motion.button
                key={c}
                type="button"
                onClick={() => setCmdIndex(i)}
                className={cn(
                  'w-full rounded-2xl border px-4 py-3 text-left text-sm transition',
                  cmdIndex === i
                    ? 'border-accent/40 bg-accent/10 text-white'
                    : 'border-white/8 bg-white/[0.02] text-neutral-400 hover:border-white/20 hover:text-neutral-200'
                )}
              >
                <span className="code text-[11px] text-accent2">$</span> {c}
              </motion.button>
            ))}
          </div>
          <div className="glass-strong rounded-[28px] p-6">
            <div className="flex items-center justify-between">
              <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">Execution preview</div>
              <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-accent2">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent2" /> Live
              </span>
            </div>
            <AnimatePresence mode="wait">
              <motion.div
                key={cmdIndex}
                initial={{ opacity: 0, y: 8, filter: 'blur(4px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -8, filter: 'blur(4px)' }}
                className="mt-4"
              >
                <div className="rounded-2xl border border-white/10 bg-black/30 p-4 font-mono text-xs leading-7 text-neutral-300">
                  {[
                    { t: '→ classify intent', c: 'text-neutral-500' },
                    { t: '→ reason + retrieve memory', c: 'text-neutral-400' },
                    { t: '→ plan tool calls', c: 'text-accent' },
                    { t: `→ execute: ${COMMANDS[cmdIndex]}`, c: 'text-white' },
                    { t: '✓ API response verified', c: 'text-accent2' },
                    { t: '✓ write to activity + memory', c: 'text-accent2' },
                  ].map((line, i) => (
                    <motion.div
                      key={line.t}
                      className={line.c}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.08 * i }}
                    >
                      {line.t}
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            </AnimatePresence>
            <form onSubmit={onDemoCommand} className="mt-5 flex gap-2">
              <input
                readOnly
                value={COMMANDS[cmdIndex]}
                className="flex-1 rounded-full border border-white/10 bg-black/30 px-4 py-2.5 text-sm text-neutral-300"
              />
              <button type="submit" className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-[#04101f]">
                Next
              </button>
            </form>
            <Link href="/register" className="mt-4 inline-flex items-center gap-2 text-sm text-accent hover:text-white">
              Start Free <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </section>

      {/* Dashboard preview */}
      <section id="product" className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <SectionHeading eyebrow="Product" title="Command surface, not a toy UI." />
        <motion.div {...fadeUp} className="glass-strong mt-12 overflow-hidden rounded-[32px] p-4 sm:p-6">
          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-[24px] border border-white/10 bg-black/30 p-5">
              <div className="text-[11px] uppercase tracking-[0.2em] text-neutral-500">Live AI activity</div>
              <div className="mt-4 space-y-3">
                {['slack.createChannel · success', 'notion.createPage · success', 'approval.pending · salesforce.update'].map((row) => (
                  <div key={row} className="flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5 text-sm text-neutral-300">
                    <span>{row}</span>
                    <Check size={14} className="text-accent2" />
                  </div>
                ))}
              </div>
              <div className="mt-5">
                <LiveSparkGraphs />
              </div>
            </div>
            <div className="space-y-4">
              {[
                ['Connected apps', '9 sources · 2 live'],
                ['Approvals', 'Human gates online'],
                ['System health', 'Chat · Agent · Queue'],
                ['Memory', 'Postgres-backed history'],
              ].map(([k, v]) => (
                <div key={k} className="rounded-[22px] border border-white/10 bg-white/[0.03] p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">{k}</div>
                  <div className="font-display mt-2 text-xl text-white">{v}</div>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </section>

      {/* Testimonials — card deck fall + strip progress */}
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <SectionHeading eyebrow="Testimonials" title="Built for operators who ship." />
        <TestimonialsSlider />
      </section>

      {/* Pricing */}
      <section id="pricing" className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <SectionHeading eyebrow="Pricing" title="Simple plans. Serious product." />
        <div className="mt-8 flex justify-center">
          <div className="inline-flex rounded-full border border-white/10 bg-white/5 p-1 text-sm">
            <button type="button" onClick={() => setYearly(false)} className={cn('rounded-full px-4 py-1.5', !yearly && 'bg-accent text-[#04101f]')}>
              Monthly
            </button>
            <button type="button" onClick={() => setYearly(true)} className={cn('rounded-full px-4 py-1.5', yearly && 'bg-accent text-[#04101f]')}>
              Yearly
            </button>
          </div>
        </div>
        <div className="mt-10 grid gap-4 lg:grid-cols-4">
          {PRICING.map((p) => (
            <motion.div
              key={p.name}
              {...fadeUp}
              className={cn(
                'rounded-[28px] border p-6',
                p.featured ? 'border-accent/40 bg-accent/10 shadow-glow' : 'border-white/8 bg-white/[0.03]'
              )}
            >
              <div className="text-sm text-neutral-400">{p.name}</div>
              <div className="font-display mt-2 text-4xl text-white">
                {p.price === 'Custom' ? p.price : yearly && p.price !== '$0' ? p.price.replace(/\d+/, (n) => String(Math.round(Number(n) * 10))) : p.price}
                {p.price !== 'Custom' && <span className="text-base text-neutral-500">/{yearly ? 'yr' : 'mo'}</span>}
              </div>
              <p className="mt-3 text-sm text-neutral-400">{p.blurb}</p>
              <ul className="mt-5 space-y-2 text-sm text-neutral-300">
                {p.items.map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <Check size={14} className="text-accent2" /> {item}
                  </li>
                ))}
              </ul>
              <Link href="/register" className="mt-6 inline-flex w-full items-center justify-center rounded-full border border-white/15 py-2.5 text-sm text-white hover:bg-white/5">
                Get started
              </Link>
            </motion.div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
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
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden px-4 pb-4 text-sm leading-7 text-neutral-400">
                    {a}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-7xl px-4 pb-24 sm:px-6">
        <motion.div {...fadeUp} className="relative overflow-hidden rounded-[36px] border border-white/10 bg-gradient-to-br from-accent/20 via-[#0b1220] to-accent2/10 px-8 py-16 text-center">
          <Globe2 className="mx-auto text-accent" size={28} />
          <h2 className="font-display mt-5 text-3xl font-semibold text-white sm:text-5xl">Ready to run work with a human gate?</h2>
          <p className="mx-auto mt-4 max-w-xl text-neutral-400">Start free, connect Slack · Jira · Notion, and Approve & run real actions from one surface.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/register" className="rounded-full bg-accent px-6 py-3 text-sm font-semibold text-[#04101f]">Start Free</Link>
            <Link href="/login" className="rounded-full border border-white/15 px-6 py-3 text-sm text-white">Book Demo</Link>
          </div>
          <div className="mt-8 flex flex-wrap justify-center gap-4 text-xs text-neutral-500">
            <span className="inline-flex items-center gap-1"><ShieldCheck size={12} /> SOC2-ready posture</span>
            <span className="inline-flex items-center gap-1"><Fingerprint size={12} /> Encrypted tokens</span>
            <span className="inline-flex items-center gap-1"><Sparkles size={12} /> Live Slack · Jira · Notion</span>
          </div>
        </motion.div>
      </section>

      <FounderDesk />

      {/* Footer */}
      <footer className="border-t border-white/5 py-14">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 md:grid-cols-4">
          <div>
            <div className="font-display tracking-[0.2em]">NEXORA</div>
            <p className="mt-3 text-sm text-neutral-500">Work Action OS — Propose → Approve → Act.</p>
          </div>
          {[
            ['Product', ['Features', 'Integrations', 'Pricing']],
            ['Developers', ['API', 'Documentation', 'Roadmap']],
            ['Company', ['Blog', 'Privacy', 'Terms', 'Contact']],
          ].map(([title, links]) => (
            <div key={title as string}>
              <div className="text-xs uppercase tracking-[0.2em] text-neutral-500">{title as string}</div>
              <ul className="mt-4 space-y-2 text-sm text-neutral-400">
                {(links as string[]).map((l) => (
                  <li key={l}><a href={`#${l.toLowerCase()}`} className="hover:text-white">{l}</a></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mx-auto mt-10 max-w-7xl px-4 text-xs text-neutral-600 sm:px-6" suppressHydrationWarning>
          © {new Date().getFullYear()} Nexora OS
        </div>
      </footer>

      <ChatAssistant />
    </div>
  );
}
