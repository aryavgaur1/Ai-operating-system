'use client';

import { Globe2, Zap } from 'lucide-react';
import { motion } from 'framer-motion';
import { RotatingGlobe } from '@/components/landing/RotatingGlobe';
import { LightningStorm } from '@/components/landing/LightningStorm';

export function CapabilityBento() {
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.15fr]">
      {/* Global Sync */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className="relative min-h-[420px] overflow-hidden rounded-[28px] border border-white/10 bg-[#080a10] p-6 sm:min-h-[460px]"
      >
        <div className="relative z-10 flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-400/30 bg-amber-400/10 text-amber-300 shadow-[0_0_24px_rgba(245,185,93,0.25)]">
            <Globe2 size={18} />
          </div>
          <div>
            <h3 className="font-display text-xl font-semibold text-white">Global Sync</h3>
            <p className="mt-1 max-w-xs text-sm leading-6 text-neutral-400">
              Work stays aligned across teams, tools, and regions without manual updates or duplicated effort.
            </p>
          </div>
        </div>
        <div className="pointer-events-none absolute bottom-0 right-0 flex w-full justify-end p-2 sm:p-4">
          <div className="relative h-72 w-72 sm:h-[22rem] sm:w-[22rem]">
            <RotatingGlobe className="!h-full !w-full !max-w-none aspect-auto" />
          </div>
        </div>
      </motion.div>

      {/* Lightning Fast */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className="relative min-h-[420px] overflow-hidden rounded-[28px] border border-white/10 bg-[#080a10] p-6 sm:min-h-[460px]"
      >
        <div className="relative z-10 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-violet-400/30 bg-violet-500/15 text-violet-300 shadow-[0_0_24px_rgba(167,139,250,0.3)]">
              <Zap size={18} />
            </div>
            <div>
              <h3 className="font-display text-xl font-semibold text-white">Lightning Fast</h3>
              <p className="mt-1 max-w-sm text-sm leading-6 text-neutral-400">
                Designed for reliability and responsiveness at enterprise scale.
              </p>
            </div>
          </div>
          <div className="shrink-0 rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-right">
            <div className="font-display text-3xl font-semibold text-white">12ms</div>
            <div className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-emerald-400">Global latency</div>
          </div>
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 top-28 sm:top-24">
          <LightningStorm />
        </div>
      </motion.div>
    </div>
  );
}
