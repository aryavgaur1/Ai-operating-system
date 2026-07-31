'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Activity, Clock, Globe2, Radio, ShieldCheck, Sparkles, Users, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

const SERIES = [
  { key: 'info', label: 'Info', color: '#3b82f6' },
  { key: 'warnings', label: 'Warnings', color: '#22d3ee' },
  { key: 'alerts', label: 'Alerts', color: '#a855f7' },
  { key: 'critical', label: 'Critical', color: '#f43f5e' },
] as const;

type Stack = { info: number; warnings: number; alerts: number; critical: number };

function seededStack(i: number): Stack {
  return {
    info: 520 + ((i * 97) % 480),
    warnings: 220 + ((i * 53) % 260),
    alerts: 90 + ((i * 37) % 160),
    critical: 24 + ((i * 19) % 80),
  };
}

function randStack(): Stack {
  return {
    info: 480 + Math.random() * 560,
    warnings: 200 + Math.random() * 300,
    alerts: 70 + Math.random() * 200,
    critical: 18 + Math.random() * 100,
  };
}

function formatCompact(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return Math.round(n).toLocaleString('en-US');
}

function LiveCounter({
  base,
  jitter,
  decimals = 0,
  suffix = '',
  prefix = '',
}: {
  base: number;
  jitter: number;
  decimals?: number;
  suffix?: string;
  prefix?: string;
}) {
  const [v, setV] = useState(base);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce) return;
    const id = window.setInterval(() => {
      setV(base + (Math.random() - 0.35) * jitter);
    }, 700);
    return () => window.clearInterval(id);
  }, [base, jitter, reduce]);

  const text =
    decimals > 0 ? `${prefix}${v.toFixed(decimals)}${suffix}` : `${prefix}${Math.round(v).toLocaleString('en-US')}${suffix}`;

  return <span className="tabular-nums">{text}</span>;
}

function Sparkline({ seed, color }: { seed: number; color: string }) {
  const [pts, setPts] = useState(() =>
    Array.from({ length: 28 }, (_, i) => 16 + ((i * seed * 3) % 14) + Math.sin(i * 0.5 + seed) * 8)
  );
  const reduce = useReducedMotion();
  const gid = useId().replace(/:/g, '');
  const [live, setLive] = useState(false);

  useEffect(() => setLive(true), []);

  useEffect(() => {
    if (!live || reduce) return;
    const id = window.setInterval(() => {
      setPts((prev) => {
        const next = prev.slice(1);
        const last = prev[prev.length - 1] ?? 20;
        next.push(Math.max(5, Math.min(36, last + (Math.random() - 0.45) * 9)));
        return next;
      });
    }, 240);
    return () => window.clearInterval(id);
  }, [live, reduce]);

  const w = 140;
  const h = 44;
  const d = pts
    .map((y, i) => `${i === 0 ? 'M' : 'L'}${((i / (pts.length - 1)) * w).toFixed(1)},${(h - y).toFixed(1)}`)
    .join(' ');
  const tipX = w;
  const tipY = h - (pts[pts.length - 1] ?? 20);

  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible" aria-hidden>
      <defs>
        <linearGradient id={`kpi-spark-${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.45" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
        <filter id={`kpi-glow-${gid}`}>
          <feGaussianBlur stdDeviation="1.4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <path d={`${d} L${w},${h} L0,${h} Z`} fill={`url(#kpi-spark-${gid})`} />
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter={`url(#kpi-glow-${gid})`}
      />
      <circle cx={tipX} cy={tipY} r="3.2" fill={color}>
        <animate attributeName="opacity" values="0.5;1;0.5" dur="1s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}

const FEED = [
  'Slack #engineering · message posted',
  'Notion · Weekly Report page created',
  'Approval gate · high-impact action queued',
  'Agent Router · plan compiled (4 steps)',
  'Memory write · workspace context synced',
  'Latency probe · us-east 142ms',
  'Notion · Investor Notes updated',
  'Slack · channel #marketing created',
];

const COLS = 32;
const MAX_Y = 1600;

export function AnalysisDashboard() {
  const reduce = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  const [cols, setCols] = useState<{ id: number; stack: Stack }[]>(() =>
    Array.from({ length: COLS }, (_, i) => ({ id: i, stack: seededStack(i) }))
  );
  const [pulseId, setPulseId] = useState(COLS - 1);
  const [feedIdx, setFeedIdx] = useState(0);
  const [clock, setClock] = useState('00:00:00');

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    const tick = () => {
      const d = new Date();
      setClock(
        [d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()]
          .map((n) => String(n).padStart(2, '0'))
          .join(':')
      );
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [mounted]);

  useEffect(() => {
    if (!mounted || reduce) return;
    const id = window.setInterval(() => {
      setCols((prev) => {
        const jittered = prev.slice(1).map((c) => ({
          ...c,
          stack: {
            info: Math.max(280, c.stack.info + (Math.random() - 0.48) * 55),
            warnings: Math.max(100, c.stack.warnings + (Math.random() - 0.48) * 36),
            alerts: Math.max(40, c.stack.alerts + (Math.random() - 0.48) * 28),
            critical: Math.max(8, c.stack.critical + (Math.random() - 0.48) * 16),
          },
        }));
        const nextId = prev[prev.length - 1]!.id + 1;
        setPulseId(nextId);
        return [...jittered, { id: nextId, stack: randStack() }];
      });
    }, 260);
    return () => window.clearInterval(id);
  }, [mounted, reduce]);

  // Live feed advances slowly — not locked to chart tick rate
  useEffect(() => {
    if (!mounted || reduce) return;
    const id = window.setInterval(() => {
      setFeedIdx((i) => (i + 1) % FEED.length);
    }, 3200);
    return () => window.clearInterval(id);
  }, [mounted, reduce]);

  const totals = useMemo(() => {
    const t = { info: 0, warnings: 0, alerts: 0, critical: 0 };
    for (const c of cols) {
      t.info += c.stack.info;
      t.warnings += c.stack.warnings;
      t.alerts += c.stack.alerts;
      t.critical += c.stack.critical;
    }
    return {
      info: Math.round(t.info),
      warnings: Math.round(t.warnings),
      alerts: Math.round(t.alerts),
      critical: Math.round(t.critical),
    };
  }, [cols]);

  const volume = totals.info + totals.warnings + totals.alerts + totals.critical;
  const yTicks = [0, 400, 800, 1200, 1600];
  const newest = cols[cols.length - 1];
  const peak = Math.round(
    Math.max(...cols.map((c) => c.stack.info + c.stack.warnings + c.stack.alerts + c.stack.critical))
  );

  const kpis = [
    {
      label: 'Events / hour',
      node: <LiveCounter base={24839} jitter={420} />,
      trend: '+18.3% vs prior hour',
      icon: Activity,
      color: '#5b9dff',
      seed: 1,
    },
    {
      label: 'Success rate',
      node: <LiveCounter base={99.24} jitter={0.08} decimals={2} suffix="%" />,
      trend: '+0.4% reliability',
      icon: ShieldCheck,
      color: '#22d3ee',
      seed: 2,
    },
    {
      label: 'p95 latency',
      node: <LiveCounter base={142} jitter={18} suffix="ms" />,
      trend: '−15.4% faster',
      icon: Clock,
      color: '#a855f7',
      seed: 3,
    },
    {
      label: 'Active operators',
      node: <LiveCounter base={1248} jitter={24} />,
      trend: '+12.6% online',
      icon: Users,
      color: '#f43f5e',
      seed: 4,
    },
  ] as const;

  return (
    <div className="relative mt-12">
      <div className="pointer-events-none absolute -top-16 left-1/2 h-64 w-[80%] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse,rgba(91,157,255,0.22),transparent_65%)] blur-2xl" />

      {/* Console chrome */}
      <div className="relative overflow-hidden rounded-[28px] border border-white/12 bg-[rgba(6,8,14,0.82)] shadow-[0_30px_100px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-2xl">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" />

        {/* top status bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400 opacity-70" />
                <span className="relative h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              <span className="font-display text-[11px] font-semibold tracking-[0.2em] text-white">NEXORA CONTROL</span>
            </div>
            <span className="hidden h-3 w-px bg-white/10 sm:block" />
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-emerald-300">
              <Radio size={10} /> Live production
            </span>
            <span className="hidden items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-neutral-500 sm:inline-flex">
              <Globe2 size={11} /> us-east · eu-west · ap-south
            </span>
          </div>
          <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.16em] text-neutral-500">
            <span className="tabular-nums text-neutral-300">{mounted ? `${clock} UTC` : '—:—:— UTC'}</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-sky-300">SLA 99.99%</span>
          </div>
        </div>

        <div className="p-4 sm:p-6">
          {/* KPI row */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {kpis.map((kpi, i) => {
              const Icon = kpi.icon;
              return (
                <motion.div
                  key={kpi.label}
                  initial={{ opacity: 0, y: 14 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.05 }}
                  className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.07] to-white/[0.02] p-4 shadow-[0_12px_40px_rgba(0,0,0,0.25)]"
                >
                  <div
                    className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full opacity-40 blur-2xl"
                    style={{ background: kpi.color }}
                  />
                  <div className="relative flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span
                        className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10"
                        style={{ background: `${kpi.color}22`, color: kpi.color, boxShadow: `0 0 20px ${kpi.color}33` }}
                      >
                        <Icon size={15} />
                      </span>
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">{kpi.label}</div>
                        <div className="font-display mt-0.5 text-2xl font-semibold text-white sm:text-[1.65rem]">
                          {kpi.node}
                        </div>
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/30 px-2 py-0.5 text-[9px] uppercase tracking-[0.14em] text-sky-300">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" />
                      Live
                    </span>
                  </div>
                  <div className="relative mt-3 flex items-end justify-between gap-2">
                    <div className="text-[11px] text-emerald-400">{kpi.trend}</div>
                    <div className="w-32 shrink-0">
                      <Sparkline seed={kpi.seed} color={kpi.color} />
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>

          {/* Main chart + side rail */}
          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_240px]">
            <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#05070d]/80 p-4 sm:p-5">
              {!reduce && mounted && (
                <motion.div
                  className="pointer-events-none absolute inset-y-0 z-10 w-28 bg-gradient-to-r from-transparent via-sky-400/12 to-transparent"
                  animate={{ left: ['-15%', '110%'] }}
                  transition={{ duration: 4.2, repeat: Infinity, ease: 'linear' }}
                />
              )}

              <div className="relative mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Zap size={14} className="text-accent" />
                  <h3 className="font-display text-sm font-semibold text-white sm:text-base">Activity Overview</h3>
                  <span className="text-neutral-600">•</span>
                  <span className="text-[10px] uppercase tracking-[0.16em] text-sky-300">Streaming</span>
                </div>
                <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.14em] text-neutral-500">
                  <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">
                    Peak <span className="text-neutral-200">{peak.toLocaleString('en-US')}</span>
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">
                    Window vol <span className="text-neutral-200">{formatCompact(volume)}</span>
                  </span>
                </div>
              </div>

              <div className="relative flex gap-3">
                <div className="flex w-10 shrink-0 flex-col justify-between pb-7 text-right text-[9px] tabular-nums text-neutral-600 sm:w-12 sm:text-[10px]">
                  {[...yTicks].reverse().map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                </div>

                <div className="relative min-w-0 flex-1">
                  <div className="pointer-events-none absolute inset-0 flex flex-col justify-between pb-7">
                    {yTicks.map((t) => (
                      <div key={t} className="border-t border-dashed border-white/[0.07]" />
                    ))}
                  </div>

                  {/* reflective floor */}
                  <div className="pointer-events-none absolute inset-x-0 bottom-7 h-16 bg-gradient-to-t from-sky-500/5 to-transparent" />

                  <div className="relative flex h-[280px] items-end gap-[2px] overflow-hidden pb-7 sm:h-[320px] sm:gap-[3px]">
                    <AnimatePresence initial={false} mode="popLayout">
                      {cols.map((col) => {
                        const s = col.stack;
                        const total = s.info + s.warnings + s.alerts + s.critical;
                        const hPct = Math.min(100, (total / MAX_Y) * 100);
                        const isNew = col.id === pulseId;
                        const parts = [
                          { h: (s.info / total) * 100, c: SERIES[0].color },
                          { h: (s.warnings / total) * 100, c: SERIES[1].color },
                          { h: (s.alerts / total) * 100, c: SERIES[2].color },
                          { h: (s.critical / total) * 100, c: SERIES[3].color },
                        ];
                        return (
                          <motion.div
                            key={col.id}
                            layout
                            className="relative flex min-w-0 flex-1 flex-col-reverse overflow-hidden rounded-t-md"
                            style={{ originY: 1 }}
                            initial={reduce ? false : { opacity: 0, x: 40, scaleY: 0.04 }}
                            animate={{
                              opacity: 1,
                              x: 0,
                              scaleY: 1,
                              height: `${hPct}%`,
                              filter: isNew ? 'brightness(1.45) saturate(1.15)' : 'brightness(1)',
                            }}
                            exit={reduce ? undefined : { opacity: 0, x: -36, scaleY: 0.35, transition: { duration: 0.2 } }}
                            transition={{
                              height: { duration: 0.26, ease: [0.16, 1, 0.3, 1] },
                              layout: { duration: 0.26 },
                              scaleY: { duration: 0.32, ease: [0.16, 1, 0.3, 1] },
                              filter: { duration: 0.3 },
                            }}
                          >
                            {parts.map((p, pi) => (
                              <motion.div
                                key={pi}
                                className="w-full"
                                animate={{ height: `${p.h}%` }}
                                transition={{ duration: 0.26 }}
                                style={{
                                  background: `linear-gradient(180deg, ${p.c}ff 0%, ${p.c}cc 55%, ${p.c}77 100%)`,
                                  boxShadow:
                                    isNew && pi === parts.length - 1
                                      ? `0 0 22px ${p.c}, 0 0 40px ${p.c}66`
                                      : pi === parts.length - 1
                                        ? `0 0 12px ${p.c}55`
                                        : undefined,
                                }}
                              />
                            ))}
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>

                    <motion.div
                      className="pointer-events-none absolute bottom-7 right-0 top-0 w-[2px]"
                      style={{
                        background: 'linear-gradient(180deg, #7dd3fc, rgba(56,189,248,0.1))',
                        boxShadow: '0 0 20px #38bdf8, 0 0 40px rgba(56,189,248,0.45)',
                      }}
                      animate={reduce ? undefined : { opacity: [0.65, 1, 0.65] }}
                      transition={{ duration: 1, repeat: Infinity }}
                    >
                      <span className="absolute -top-1 right-0 translate-x-1/2">
                        <span className="relative flex h-3.5 w-3.5">
                          <span className="absolute inset-0 animate-ping rounded-full bg-sky-300 opacity-70" />
                          <span className="relative h-3.5 w-3.5 rounded-full bg-sky-200 shadow-[0_0_18px_#38bdf8]" />
                        </span>
                      </span>
                      <span className="absolute -right-1 top-4 translate-x-full text-[9px] font-semibold uppercase tracking-[0.18em] text-sky-200">
                        Now
                      </span>
                    </motion.div>
                    <div className="pointer-events-none absolute bottom-7 right-0 top-0 w-20 bg-gradient-to-l from-sky-400/20 to-transparent" />
                  </div>

                  <div className="flex justify-between px-0.5 text-[9px] tabular-nums text-neutral-600 sm:text-[10px]">
                    {['−20m', '−15m', '−10m', '−5m', 'Now'].map((l) => (
                      <span key={l}>{l}</span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-white/8 pt-4">
                {SERIES.map((s) => (
                  <div key={s.key} className="flex items-center gap-2 text-xs text-neutral-400">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: s.color, boxShadow: `0 0 10px ${s.color}` }}
                    />
                    <span>{s.label}</span>
                    <span className="font-display tabular-nums text-neutral-100">
                      {totals[s.key].toLocaleString('en-US')}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Side ops rail */}
            <div className="flex flex-col gap-3">
              <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-transparent p-4">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-neutral-500">
                  <Sparkles size={12} className="text-accent" /> Live feed
                </div>
                <div className="mt-3 space-y-2.5">
                  {Array.from({ length: 5 }, (_, i) => {
                    const item = FEED[(feedIdx + i) % FEED.length]!;
                    return (
                      <motion.div
                        key={`${feedIdx}-${i}`}
                        initial={reduce ? false : { opacity: 0, y: 8 }}
                        animate={{ opacity: 1 - i * 0.12, y: 0 }}
                        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                        className={cn(
                          'rounded-xl border px-3 py-2 text-[11px] leading-4',
                          i === 0
                            ? 'border-accent/35 bg-accent/10 text-neutral-100'
                            : 'border-white/8 bg-white/[0.02] text-neutral-400'
                        )}
                      >
                        {item}
                      </motion.div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">This tick</div>
                <div className="font-display mt-2 text-3xl font-semibold text-white">
                  {newest
                    ? Math.round(
                        newest.stack.info + newest.stack.warnings + newest.stack.alerts + newest.stack.critical
                      ).toLocaleString('en-US')
                    : '—'}
                </div>
                <div className="mt-1 text-xs text-neutral-500">events entering at NOW</div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {[
                    ['Regions', '3'],
                    ['Agents', '8'],
                    ['Tools', '16'],
                    ['Uptime', '99.99%'],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-xl border border-white/8 bg-black/20 px-2.5 py-2">
                      <div className="text-[9px] uppercase tracking-[0.14em] text-neutral-600">{k}</div>
                      <div className="font-display mt-0.5 text-sm text-white">{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
