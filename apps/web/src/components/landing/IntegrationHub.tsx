'use client';

import Image from 'next/image';
import { motion } from 'framer-motion';
import { BrandLogo } from '@/components/landing/BrandLogos';

const LEFT = [
  { name: 'Slack', sub: 'Team messaging' },
  { name: 'Notion', sub: 'Docs & knowledge' },
  { name: 'Jira', sub: 'Issue tracking' },
  { name: 'Gmail', sub: 'Email threads' },
];

const RIGHT = [
  { name: 'Salesforce', sub: 'CRM pipeline' },
  { name: 'Google Workspace', sub: 'Docs & email' },
  { name: 'Microsoft 365', sub: 'Office productivity' },
  { name: 'GitHub', sub: 'Code & PRs' },
];

function LightningWire({ side, delay }: { side: 'left' | 'right'; delay: number }) {
  const isLeft = side === 'left';
  return (
    <div className="relative hidden h-[2px] flex-1 overflow-hidden md:block">
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/15 to-transparent" />
      <motion.div
        className={`absolute top-1/2 h-[3px] w-16 -translate-y-1/2 rounded-full shadow-[0_0_12px_rgba(245,185,93,0.9)] ${
          isLeft
            ? 'bg-gradient-to-r from-transparent via-amber-300 to-accent'
            : 'bg-gradient-to-l from-transparent via-amber-300 to-accent'
        }`}
        animate={isLeft ? { left: ['-20%', '110%'] } : { right: ['-20%', '110%'] }}
        transition={{ duration: 1.8, repeat: Infinity, delay, ease: 'easeInOut', repeatDelay: 0.4 }}
      />
      <motion.div
        className="absolute top-1/2 h-[2px] w-8 -translate-y-1/2 rounded-full bg-white shadow-[0_0_10px_#fff]"
        animate={isLeft ? { left: ['-10%', '120%'] } : { right: ['-10%', '120%'] }}
        transition={{ duration: 1.1, repeat: Infinity, delay: delay + 0.55, ease: 'linear', repeatDelay: 1.2 }}
      />
    </div>
  );
}

function ToolCard({ name, sub, align }: { name: string; sub: string; align: 'left' | 'right' }) {
  return (
    <div
      className={`flex items-center gap-3 rounded-2xl border border-white/10 bg-black/40 px-4 py-3 backdrop-blur-md ${
        align === 'right' ? 'flex-row-reverse text-right' : ''
      }`}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 p-1.5">
        <BrandLogo name={name} className="h-full w-full" />
      </div>
      <div className="min-w-0">
        <div className="font-display text-sm font-semibold text-white">{name}</div>
        <div className="text-[10px] uppercase tracking-[0.16em] text-neutral-500">{sub}</div>
      </div>
    </div>
  );
}

export function IntegrationHub() {
  return (
    <div className="relative mx-auto max-w-5xl">
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-500/10 blur-[80px]" />

      <div className="grid items-center gap-4 md:grid-cols-[1fr_auto_1fr]">
        <div className="flex flex-col gap-3">
          {LEFT.map((t, i) => (
            <div key={t.name} className="flex items-center gap-0">
              <div className="w-full md:ml-auto md:w-[min(100%,220px)]">
                <ToolCard {...t} align="left" />
              </div>
              <LightningWire side="left" delay={i * 0.35} />
            </div>
          ))}
        </div>

        <div className="relative mx-auto flex w-full max-w-[220px] flex-col items-center">
          <motion.div
            className="absolute inset-[-18%] rounded-[32px] border border-amber-400/30"
            animate={{ opacity: [0.35, 0.85, 0.35], scale: [1, 1.03, 1] }}
            transition={{ duration: 2.8, repeat: Infinity }}
          />
          <motion.div
            className="absolute inset-[-8%] rounded-[28px] border border-accent/25"
            animate={{ rotate: 360 }}
            transition={{ duration: 40, repeat: Infinity, ease: 'linear' }}
          />
          <div className="relative w-full overflow-hidden rounded-[24px] border border-white/12 bg-gradient-to-b from-[#121826] to-[#07080e] p-5 shadow-[0_0_60px_rgba(245,185,93,0.12)]">
            <div className="relative mx-auto aspect-square w-28 sm:w-32">
              <Image
                src="/nexora-logo.png"
                alt="Nexora"
                fill
                className="object-contain drop-shadow-[0_0_24px_rgba(91,157,255,0.35)]"
                sizes="128px"
                priority
              />
            </div>
            <div className="mt-4 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-center">
              <div className="flex items-center justify-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-300">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                </span>
                Active 99.9%
              </div>
              <div className="mt-1 font-mono text-[10px] text-neutral-500">&gt; Streaming data …</div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {RIGHT.map((t, i) => (
            <div key={t.name} className="flex items-center gap-0">
              <LightningWire side="right" delay={i * 0.35 + 0.2} />
              <div className="w-full md:w-[min(100%,220px)]">
                <ToolCard {...t} align="right" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
