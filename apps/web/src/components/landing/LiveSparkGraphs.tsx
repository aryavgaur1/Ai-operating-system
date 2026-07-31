'use client';

import { motion, useMotionValue, useTransform, animate } from 'framer-motion';
import { useEffect, useState } from 'react';

function Spark({ seed = 1, color = '#5b9dff' }: { seed?: number; color?: string }) {
  const [pts, setPts] = useState(() =>
    Array.from({ length: 28 }, (_, i) => 32 + Math.sin(i * 0.42 + seed) * 16 + ((i * seed) % 6))
  );

  useEffect(() => {
    const id = window.setInterval(() => {
      setPts((prev) => {
        const next = prev.slice(1);
        const last = prev[prev.length - 1] ?? 40;
        next.push(Math.max(10, Math.min(68, last + (Math.random() - 0.48) * 12)));
        return next;
      });
    }, 280);
    return () => window.clearInterval(id);
  }, []);

  const w = 240;
  const h = 76;
  const path = pts
    .map((y, i) => {
      const x = (i / (pts.length - 1)) * w;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${(h - y).toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible" aria-hidden>
      <defs>
        <linearGradient id={`spark-fill-${seed}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.4" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${path} L${w},${h} L0,${h} Z`} fill={`url(#spark-fill-${seed})`} />
      <motion.path d={path} fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      {/* live tip */}
      <circle
        cx={((pts.length - 1) / (pts.length - 1)) * w}
        cy={h - (pts[pts.length - 1] ?? 40)}
        r="3"
        fill={color}
        opacity="0.9"
      >
        <animate attributeName="opacity" values="0.5;1;0.5" dur="1.2s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}

function LiveValue({ value, suffix = '' }: { value: number; suffix?: string }) {
  const mv = useMotionValue(value);
  const display = useTransform(mv, (v) =>
    suffix === '%' || suffix === 'ms'
      ? `${v.toFixed(suffix === '%' ? 1 : 0)}${suffix}`
      : `${Math.round(v).toLocaleString('en-US')}${suffix}`
  );
  const [text, setText] = useState(`${value}${suffix}`);

  useEffect(() => {
    const unsub = display.on('change', (v) => setText(v));
    const id = window.setInterval(() => {
      const jitter =
        suffix === '%'
          ? (Math.random() - 0.5) * 0.08
          : suffix === 'ms'
            ? (Math.random() - 0.5) * 8
            : (Math.random() - 0.4) * 24;
      animate(mv, Math.max(0, value + jitter), { duration: 0.45 });
    }, 900);
    return () => {
      unsub();
      window.clearInterval(id);
    };
  }, [display, mv, suffix, value]);

  return <span>{text}</span>;
}

const METRICS = [
  { label: 'Executions / min', value: 1284, suffix: '', delta: '+12%', color: '#5b9dff', seed: 1 },
  { label: 'Success rate', value: 99.2, suffix: '%', delta: '+0.4%', color: '#8be9d0', seed: 2 },
  { label: 'Avg latency', value: 186, suffix: 'ms', delta: '-8%', color: '#f5b95d', seed: 3 },
];

export function LiveSparkGraphs() {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {METRICS.map((m) => (
        <motion.div
          key={m.label}
          className="glass rounded-2xl p-4"
          whileHover={{ y: -2, borderColor: 'rgba(91,157,255,0.35)' }}
        >
          <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.16em] text-neutral-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent2/70" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent2" />
              </span>
              {m.label}
            </span>
            <span className="text-accent2">{m.delta}</span>
          </div>
          <div className="mt-2 font-display text-2xl font-semibold text-white">
            <LiveValue value={m.value} suffix={m.suffix} />
          </div>
          <div className="mt-1">
            <Spark seed={m.seed} color={m.color} />
          </div>
        </motion.div>
      ))}
    </div>
  );
}
