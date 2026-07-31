'use client';

import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

const TESTIMONIALS = [
  {
    quote:
      'Nexora feels like an OS, not a chat box. Slack channels appear when I ask — and the work actually lands.',
    name: 'Aryav Gaur',
    role: 'Product',
    company: 'Nexora',
  },
  {
    quote:
      'We run client delivery across tools. Nexora is the layer that finally connects intent to execution for BuilderFellows.',
    name: 'Priyanshu Gupta',
    role: 'Founder',
    company: 'BuilderFellows',
  },
  {
    quote:
      'Approvals + live Notion execution is what made this investor-ready for our team at NextWave India.',
    name: 'Abhishek Sharma',
    role: 'Founder',
    company: 'NextWave India',
  },
  {
    quote:
      'Our US studio juggles a dozen SaaS tools. Nexora collapsed that chaos into one command surface.',
    name: 'Sarah Chen',
    role: 'Partner',
    company: 'Meridian Collective',
  },
  {
    quote:
      'Finally an agent stack that executes against real APIs — not slideware demos. Northstar ships on it weekly.',
    name: 'James Okonkwo',
    role: 'Agency Lead',
    company: 'Northstar Digital',
  },
  {
    quote:
      'From brief to Notion docs in one flow. Studio Forma cut handoff time without losing creative control.',
    name: 'Elena Rossi',
    role: 'Creative Director',
    company: 'Studio Forma',
  },
  {
    quote:
      'Apex Labs needed observable automation. Nexora’s timeline is the audit trail our clients ask for.',
    name: 'Marcus Webb',
    role: 'Founder',
    company: 'Apex Labs',
  },
  {
    quote:
      'Lumen Agency runs ops across timezones. Persistent memory is the difference between assistants and an OS.',
    name: 'Amélie Dubois',
    role: 'Head of Ops',
    company: 'Lumen Agency',
  },
] as const;

function initials(name: string) {
  return name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/** Gravity fall — accelerates downward so the tumble is obvious */
const FALL_EASE: [number, number, number, number] = [0.55, 0.05, 0.9, 0.25];

export function TestimonialsSlider() {
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState(1);
  const [falling, setFalling] = useState(false);
  const n = TESTIMONIALS.length;

  const go = useCallback(
    (next: number, direction = 1) => {
      if (falling && !reduce) return;
      setDir(direction);
      setFalling(true);
      setIndex(((next % n) + n) % n);
      window.setTimeout(() => setFalling(false), direction === 1 ? 780 : 480);
    },
    [n, falling, reduce]
  );

  const fallNext = useCallback(() => go(index + 1, 1), [go, index]);
  const fallPrev = useCallback(() => go(index - 1, -1), [go, index]);

  useEffect(() => {
    if (reduce) return;
    const id = window.setInterval(() => {
      setDir(1);
      setFalling(true);
      setIndex((i) => (i + 1) % n);
      window.setTimeout(() => setFalling(false), 780);
    }, 5600);
    return () => window.clearInterval(id);
  }, [n, reduce]);

  const current = TESTIMONIALS[index]!;
  const progress = ((index + 1) / n) * 100;
  const peek = [1, 2].map((offset) => TESTIMONIALS[(index + offset) % n]!);

  return (
    <div className="relative mx-auto mt-14 max-w-3xl">
      <div className="pointer-events-none absolute inset-x-10 -top-8 h-40 rounded-full bg-accent/15 blur-3xl" />

      {/* Tall stage so the fall stays on-screen */}
      <div className="relative mx-auto h-[420px] overflow-visible sm:h-[460px]">
        {/* under-deck peeks */}
        {peek.map((t, i) => (
          <motion.div
            key={`${t.name}-peek-${index}`}
            aria-hidden
            className="absolute inset-x-4 top-4 overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.05] sm:inset-x-8"
            style={{
              height: '300px',
              zIndex: 2 - i,
              WebkitBackdropFilter: 'blur(12px)',
              backdropFilter: 'blur(12px)',
            }}
            initial={false}
            animate={{
              y: (i + 1) * 14,
              scale: 1 - (i + 1) * 0.045,
              opacity: 0.5 - i * 0.12,
            }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          />
        ))}

        <AnimatePresence initial={false} custom={dir}>
          <motion.button
            key={current.name}
            type="button"
            custom={dir}
            initial={
              reduce
                ? { opacity: 0 }
                : dir === 1
                  ? { opacity: 0, y: 18, scale: 0.96, rotate: -1 }
                  : { opacity: 0, y: -30, scale: 0.97, rotate: 2 }
            }
            animate={{
              opacity: 1,
              y: 0,
              x: 0,
              scale: 1,
              rotate: 0,
              filter: 'blur(0px)',
              transition: { type: 'spring', stiffness: 320, damping: 28, delay: dir === 1 ? 0.12 : 0 },
            }}
            exit={
              reduce
                ? { opacity: 0 }
                : dir === 1
                  ? {
                      // dramatic tumble — stays opaque mid-fall so you can see it
                      y: 520,
                      x: 70,
                      rotate: 22,
                      scale: 0.92,
                      opacity: [1, 1, 0.85, 0],
                      filter: ['blur(0px)', 'blur(0px)', 'blur(2px)', 'blur(6px)'],
                      transition: {
                        duration: 0.75,
                        ease: FALL_EASE,
                        opacity: { duration: 0.75, times: [0, 0.55, 0.82, 1] },
                        filter: { duration: 0.75, times: [0, 0.45, 0.75, 1] },
                      },
                    }
                  : {
                      y: -80,
                      x: -24,
                      rotate: -10,
                      opacity: 0,
                      scale: 0.96,
                      transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] },
                    }
            }
            onClick={fallNext}
            className={cn(
              'absolute inset-x-0 top-0 z-20 flex h-[300px] cursor-pointer flex-col overflow-hidden rounded-[28px] border border-white/15 bg-[rgba(12,14,22,0.85)] p-6 text-left shadow-[0_28px_70px_rgba(0,0,0,0.55)] sm:h-[320px] sm:p-8',
              'hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
              falling && 'pointer-events-none'
            )}
            style={{
              WebkitBackdropFilter: 'blur(22px)',
              backdropFilter: 'blur(22px)',
              transformOrigin: '70% 20%',
              willChange: 'transform, opacity, filter',
            }}
            aria-label="Tap — card falls to reveal next"
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/35 to-transparent" />
            <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-accent/20 blur-3xl" />

            <div className="font-display text-5xl leading-none text-accent/35">“</div>
            <p className="mt-2 flex-1 text-base leading-8 text-neutral-200 sm:text-lg sm:leading-8">
              {current.quote}
            </p>

            <div className="mt-6 flex items-center gap-4 border-t border-white/10 pt-5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-accent/30 bg-accent/15 text-sm font-semibold text-accent">
                {initials(current.name)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-display text-sm font-semibold text-white sm:text-base">{current.name}</div>
                <div className="truncate text-xs text-neutral-500">
                  {current.role}
                  {current.company ? ` · ${current.company}` : ''}
                </div>
              </div>
              <div className="hidden rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-neutral-400 sm:block">
                Tap to fall
              </div>
            </div>
          </motion.button>
        </AnimatePresence>

        {/* floor shadow flash when card hits */}
        <motion.div
          key={`shadow-${index}`}
          className="pointer-events-none absolute bottom-6 left-1/2 h-3 w-[70%] -translate-x-1/2 rounded-full bg-black/50 blur-md"
          initial={{ opacity: 0, scaleX: 0.6 }}
          animate={{ opacity: [0, 0, 0.55, 0], scaleX: [0.6, 0.6, 1.1, 0.8] }}
          transition={{ duration: 0.75, times: [0, 0.55, 0.78, 1], ease: 'easeOut' }}
        />
      </div>

      <div className="mt-2 flex items-center gap-4">
        <button
          type="button"
          onClick={fallPrev}
          disabled={falling}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/5 text-neutral-300 transition hover:border-white/25 hover:text-white disabled:opacity-40"
          aria-label="Previous testimonial"
        >
          <ChevronLeft size={18} />
        </button>

        <div className="min-w-0 flex-1">
          <div className="mb-2 flex justify-between text-[10px] uppercase tracking-[0.18em] text-neutral-500">
            <span>
              {String(index + 1).padStart(2, '0')} / {String(n).padStart(2, '0')}
            </span>
            <span className="truncate pl-4 text-neutral-400">{current.company}</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-white/10">
            <motion.div
              className="h-full rounded-full bg-accent"
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            />
          </div>
          <div className="mt-3 flex justify-center gap-1.5">
            {TESTIMONIALS.map((t, i) => (
              <button
                key={t.name}
                type="button"
                aria-label={`Show ${t.name}`}
                disabled={falling}
                onClick={() => go(i, i > index ? 1 : -1)}
                className={cn(
                  'h-1.5 rounded-full transition-all duration-300 disabled:opacity-40',
                  i === index ? 'w-6 bg-accent' : 'w-1.5 bg-white/20 hover:bg-white/40'
                )}
              />
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={fallNext}
          disabled={falling}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/5 text-neutral-300 transition hover:border-white/25 hover:text-white disabled:opacity-40"
          aria-label="Next testimonial — card falls"
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}
