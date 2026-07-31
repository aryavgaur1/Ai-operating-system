'use client';

import { useEffect, useId, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Brain, ShieldCheck, Wrench, Network } from 'lucide-react';
import { cn } from '@/lib/utils';

const LAYERS = [
  {
    title: 'AI Memory',
    body: 'Persistent, contextual memory that improves over time—so every interaction builds on the last.',
    icon: Brain,
    accent: 'from-sky-400/30 to-blue-600/10',
  },
  {
    title: 'Reasoning',
    body: 'Advanced reasoning engine that breaks down complexity and delivers accurate, explainable outcomes.',
    icon: Network,
    accent: 'from-cyan-400/25 to-sky-700/10',
  },
  {
    title: 'Tools',
    body: 'Native integrations and extensible tools that let Nexora act—securely—across your systems.',
    icon: Wrench,
    accent: 'from-blue-400/25 to-indigo-700/10',
  },
  {
    title: 'Approvals',
    body: 'Human-in-the-loop controls and policy guardrails ensure the right decisions get made, every time.',
    icon: ShieldCheck,
    accent: 'from-teal-400/25 to-sky-800/10',
  },
] as const;

/** Independent float: each layer bobbing up↔down on its own phase/amplitude */
const FLOAT = [
  { y: [-10, 10, -10], duration: 4.2 },
  { y: [12, -8, 12], duration: 5.1 },
  { y: [-8, 14, -8], duration: 4.6 },
  { y: [10, -12, 10], duration: 5.4 },
] as const;

export function WhyNexora() {
  const reduce = useReducedMotion();
  const uid = useId().replace(/:/g, '');
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const id = window.setInterval(() => {
      setActive((a) => (a + 1) % LAYERS.length);
    }, 2800);
    return () => window.clearInterval(id);
  }, [reduce]);

  const glowId = `glass-glow-${uid}`;
  const wireGrad = `wire-grad-${uid}`;

  return (
    <div className="relative mt-14 grid items-center gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8 xl:gap-12">
      {/* Left — copy + feature list */}
      <div>
        <ul className="space-y-5">
          {LAYERS.map((layer, i) => {
            const Icon = layer.icon;
            const lit = active === i;
            return (
              <motion.li
                key={layer.title}
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.45, delay: i * 0.08 }}
              >
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onClick={() => setActive(i)}
                  className={cn(
                    'group relative flex w-full gap-4 rounded-2xl border px-4 py-3.5 text-left transition-all duration-500',
                    lit
                      ? 'border-accent/40 bg-accent/10 shadow-[0_0_28px_rgba(91,157,255,0.12)]'
                      : 'border-transparent bg-transparent hover:border-white/10 hover:bg-white/[0.03]'
                  )}
                >
                  <motion.span
                    className={cn(
                      'mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border',
                      lit
                        ? 'border-accent/50 bg-accent/20 text-accent'
                        : 'border-white/10 bg-white/5 text-neutral-300'
                    )}
                    animate={
                      lit && !reduce
                        ? {
                            boxShadow: [
                              '0 0 0 rgba(91,157,255,0)',
                              '0 0 16px rgba(91,157,255,0.45)',
                              '0 0 0 rgba(91,157,255,0)',
                            ],
                          }
                        : undefined
                    }
                    transition={{ duration: 1.8, repeat: Infinity }}
                  >
                    <Icon size={18} />
                  </motion.span>
                  <div className="min-w-0 flex-1">
                    <h3 className={cn('font-display text-base font-semibold', lit ? 'text-white' : 'text-neutral-200')}>
                      {layer.title}
                    </h3>
                    <p className={cn('mt-1 text-sm leading-6', lit ? 'text-neutral-300' : 'text-neutral-500')}>
                      {layer.body}
                    </p>
                  </div>

                  {/* wire stub toward stack (desktop) */}
                  <span
                    className={cn(
                      'pointer-events-none absolute right-0 top-1/2 hidden h-px w-8 translate-x-full lg:block xl:w-12',
                      lit ? 'bg-accent/70' : 'bg-white/10'
                    )}
                    aria-hidden
                  />
                  <span
                    className={cn(
                      'pointer-events-none absolute right-0 top-1/2 hidden h-2 w-2 translate-x-[calc(100%+1.75rem)] -translate-y-1/2 rounded-full border xl:translate-x-[calc(100%+2.75rem)] lg:block',
                      lit ? 'border-accent bg-accent shadow-[0_0_10px_#5b9dff]' : 'border-white/20 bg-[#0a0c12]'
                    )}
                    aria-hidden
                  />
                </button>
              </motion.li>
            );
          })}
        </ul>
      </div>

      {/* Right — floating glass stack */}
      <div className="relative mx-auto w-full max-w-md perspective-[1200px] lg:max-w-none">
        {/* ambient glow */}
        <div className="pointer-events-none absolute inset-x-8 bottom-8 top-0 rounded-[40%] bg-[radial-gradient(ellipse_at_50%_70%,rgba(91,157,255,0.28),transparent_65%)] blur-2xl" />

        {/* connecting wires SVG between list and stack */}
        <svg
          className="pointer-events-none absolute -left-16 top-0 hidden h-full w-16 lg:block xl:-left-20 xl:w-20"
          viewBox="0 0 80 400"
          preserveAspectRatio="none"
          aria-hidden
        >
          <defs>
            <linearGradient id={wireGrad} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#5b9dff" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#5b9dff" stopOpacity="0.85" />
            </linearGradient>
            <filter id={glowId}>
              <feGaussianBlur stdDeviation="1.5" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {[48, 140, 232, 324].map((y, i) => {
            const lit = active === i;
            const d = `M0 ${y} C 28 ${y}, 40 ${70 + i * 70}, 80 ${70 + i * 70}`;
            return (
              <g key={i}>
                <motion.path
                  d={d}
                  fill="none"
                  stroke={lit ? '#5b9dff' : 'rgba(91,157,255,0.25)'}
                  strokeWidth={lit ? 1.6 : 1}
                  filter={lit ? `url(#${glowId})` : undefined}
                  strokeDasharray={lit ? '0 0' : '4 6'}
                  animate={reduce ? undefined : { strokeDashoffset: lit ? 0 : [0, -20] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }}
                />
                {!reduce && (
                  <circle r={lit ? 2.4 : 1.6} fill={lit ? '#fff' : '#5b9dff'}>
                    <animateMotion dur={lit ? '1.1s' : '2.2s'} repeatCount="indefinite" path={d} />
                  </circle>
                )}
              </g>
            );
          })}
        </svg>

        <div
          className="relative flex flex-col items-center pt-2"
          style={{ transformStyle: 'preserve-3d', transform: 'rotateX(8deg) rotateY(-12deg)' }}
        >
          {/* Floating glass layers — top to bottom (Memory → Approvals) */}
          <div className="relative z-10 flex w-full flex-col items-center gap-3 sm:gap-4">
            {LAYERS.map((layer, i) => {
              const Icon = layer.icon;
              const lit = active === i;
              const float = FLOAT[i]!;
              return (
                <motion.div
                  key={layer.title}
                  className="w-[88%] sm:w-[90%]"
                  style={{ zIndex: LAYERS.length - i }}
                  animate={
                    reduce
                      ? undefined
                      : {
                          y: [...float.y],
                        }
                  }
                  transition={{
                    duration: float.duration,
                    repeat: Infinity,
                    ease: 'easeInOut',
                    delay: i * 0.35,
                  }}
                  onMouseEnter={() => setActive(i)}
                >
                  <motion.div
                    className={cn(
                      'relative overflow-hidden rounded-2xl border px-5 py-4 backdrop-blur-xl transition-colors duration-500',
                      lit
                        ? 'border-accent/55 bg-white/10 shadow-[0_0_40px_rgba(91,157,255,0.25),0_12px_40px_rgba(0,0,0,0.45)]'
                        : 'border-white/15 bg-white/[0.06] shadow-[0_10px_30px_rgba(0,0,0,0.35)]'
                    )}
                    animate={
                      lit && !reduce
                        ? { scale: [1, 1.02, 1] }
                        : { scale: 1 }
                    }
                    transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    <div className={cn('pointer-events-none absolute inset-0 bg-gradient-to-br opacity-80', layer.accent)} />
                    {/* glass sheen */}
                    <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" />
                    <div className="relative z-10 flex items-center gap-3">
                      <span
                        className={cn(
                          'flex h-9 w-9 items-center justify-center rounded-xl border',
                          lit ? 'border-accent/50 bg-accent/25 text-accent' : 'border-white/15 bg-black/30 text-sky-200'
                        )}
                      >
                        <Icon size={16} />
                      </span>
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.2em] text-sky-300/70">Layer 0{i + 1}</div>
                        <div className="font-display text-sm font-semibold text-white sm:text-base">{layer.title}</div>
                      </div>
                      {lit && (
                        <motion.span
                          className="ml-auto h-1.5 w-1.5 rounded-full bg-accent"
                          animate={{ opacity: [1, 0.3, 1] }}
                          transition={{ duration: 1.2, repeat: Infinity }}
                        />
                      )}
                    </div>
                  </motion.div>
                </motion.div>
              );
            })}
          </div>

          {/* Kernel base */}
          <motion.div
            className="relative z-0 mt-2 w-full"
            animate={reduce ? undefined : { y: [4, -4, 4] }}
            transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
          >
            <div className="relative mx-auto w-[96%] overflow-hidden rounded-2xl border border-accent/40 bg-gradient-to-b from-[#1a3a6e] to-[#0a1628] px-5 py-5 shadow-[0_0_50px_rgba(91,157,255,0.35),0_20px_50px_rgba(0,0,0,0.5)] sm:py-6">
              <div
                className="pointer-events-none absolute inset-0 opacity-40"
                style={{
                  backgroundImage:
                    'linear-gradient(rgba(125,182,255,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(125,182,255,0.15) 1px, transparent 1px)',
                  backgroundSize: '18px 18px',
                }}
              />
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sky-300/60 to-transparent" />
              <div className="relative z-10 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/20 bg-white/10 font-display text-[10px] font-bold tracking-wider text-white">
                  NX
                </div>
                <div>
                  <div className="font-display text-sm font-semibold tracking-[0.12em] text-white sm:text-base">
                    NEXORA KERNEL
                  </div>
                  <div className="mt-0.5 text-[11px] text-sky-200/70">Secure. Reliable. Always on.</div>
                </div>
              </div>
              {/* rising signal lines into stack */}
              {!reduce && (
                <div className="pointer-events-none absolute inset-x-8 -top-6 flex justify-around">
                  {[0, 1, 2, 3].map((i) => (
                    <motion.span
                      key={i}
                      className="h-6 w-px bg-gradient-to-t from-accent to-transparent"
                      animate={{ opacity: [0.2, 1, 0.2], scaleY: [0.6, 1, 0.6] }}
                      transition={{ duration: 1.8, repeat: Infinity, delay: i * 0.25 }}
                    />
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
