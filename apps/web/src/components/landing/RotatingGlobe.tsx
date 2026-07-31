'use client';

import { motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';

/** Dense landmass dots for a spinning globe silhouette */
const LAND = [
  [22, 34], [24, 38], [26, 42], [28, 36], [30, 40], [32, 44], [34, 38], [20, 48], [24, 52], [28, 56],
  [48, 28], [50, 32], [52, 30], [54, 34], [56, 38], [58, 32], [60, 36], [62, 40], [64, 34], [66, 42],
  [68, 38], [70, 44], [72, 40], [74, 46], [76, 42], [78, 48], [80, 44], [54, 50], [56, 54], [58, 58],
  [52, 56], [78, 62], [80, 66], [82, 70], [84, 64], [40, 70], [42, 74], [38, 72], [46, 36], [44, 40],
];

type Props = {
  /** Compact card mode vs full hero */
  compact?: boolean;
  className?: string;
};

/**
 * Continuously spinning 360° globe with latitude/longitude borders —
 * Gaprio-style Global Sync visual.
 */
export function RotatingGlobe({ compact = false, className = '' }: Props) {
  const dots = useMemo(
    () =>
      Array.from({ length: compact ? 28 : 42 }, (_, i) => ({
        x: (i * 19) % 100,
        y: (i * 31 + 11) % 100,
        s: 0.35 + (i % 3) * 0.2,
        d: (i % 6) * 0.4,
      })),
    [compact]
  );

  return (
    <div
      className={`relative ${
        compact ? 'h-44 w-44 sm:h-52 sm:w-52' : 'aspect-square w-full max-w-[420px]'
      } ${className}`}
    >
      {/* atmospheric glow */}
      <div className="absolute inset-[-8%] rounded-full bg-[radial-gradient(circle_at_center,rgba(245,185,93,0.22),transparent_62%)] blur-xl" />
      <div className="absolute inset-[-4%] rounded-full bg-[radial-gradient(circle_at_70%_80%,rgba(91,157,255,0.2),transparent_55%)]" />

      {/* outer border rings — slow counter-rotate */}
      <motion.div
        className="absolute inset-0 rounded-full border border-white/15"
        animate={{ rotate: 360 }}
        transition={{ duration: 48, repeat: Infinity, ease: 'linear' }}
      />
      <motion.div
        className="absolute inset-[5%] rounded-full border border-dashed border-amber-400/35"
        animate={{ rotate: -360 }}
        transition={{ duration: 64, repeat: Infinity, ease: 'linear' }}
      />
      <motion.div
        className="absolute inset-[10%] rounded-full border border-accent/25"
        animate={{ rotate: 360 }}
        transition={{ duration: 90, repeat: Infinity, ease: 'linear' }}
      />

      {/* spinning globe disk */}
      <div className="absolute inset-[14%] overflow-hidden rounded-full border border-white/12 bg-[radial-gradient(circle_at_30%_28%,rgba(91,157,255,0.22),transparent_45%),linear-gradient(160deg,#0a1428,#05060a)] shadow-[inset_0_0_40px_rgba(0,0,0,0.55),0_0_40px_rgba(91,157,255,0.15)]">
        <motion.div
          className="absolute inset-0"
          animate={{ rotate: 360 }}
          transition={{ duration: 28, repeat: Infinity, ease: 'linear' }}
        >
          <svg className="h-full w-full" viewBox="0 0 100 100" aria-hidden>
            {/* latitude */}
            {[14, 22, 30, 38].map((ry) => (
              <ellipse
                key={ry}
                cx="50"
                cy="50"
                rx={ry * 1.05}
                ry={ry * 0.55}
                fill="none"
                stroke="rgba(255,255,255,0.1)"
                strokeWidth="0.3"
              />
            ))}
            {/* longitude */}
            {[0, 30, 60, 90, 120, 150].map((deg) => {
              const rad = (deg * Math.PI) / 180;
              return (
                <line
                  key={deg}
                  x1={50 - Math.cos(rad) * 40}
                  y1={50 - Math.sin(rad) * 26}
                  x2={50 + Math.cos(rad) * 40}
                  y2={50 + Math.sin(rad) * 26}
                  stroke="rgba(255,255,255,0.07)"
                  strokeWidth="0.25"
                />
              );
            })}
            {LAND.map(([x, y], i) => (
              <circle
                key={`${x}-${y}-${i}`}
                cx={x}
                cy={y}
                r={1.1 + (i % 3) * 0.2}
                fill="rgba(200,220,255,0.55)"
              />
            ))}
          </svg>
        </motion.div>

        {/* starfield overlay (fixed, not spinning with land — subtle pulse) */}
        {dots.map((p, i) => (
          <motion.span
            key={i}
            className="absolute rounded-full bg-white"
            style={{ left: `${p.x}%`, top: `${p.y}%`, width: p.s, height: p.s }}
            animate={{ opacity: [0.15, 0.65, 0.15] }}
            transition={{ duration: 2.2 + p.d, repeat: Infinity, delay: p.d }}
          />
        ))}

        {/* terminator / shine */}
        <div className="pointer-events-none absolute inset-0 rounded-full bg-[linear-gradient(105deg,transparent_35%,rgba(255,255,255,0.08)_48%,transparent_62%)]" />
      </div>
    </div>
  );
}

/** Continuous rising/falling bars — Lightning Fast card */
export function LiveBarWave({ className = '' }: { className?: string }) {
  const [bars, setBars] = useState(() =>
    Array.from({ length: 42 }, (_, i) => 28 + Math.sin(i * 0.45) * 22 + (i % 5) * 2)
  );

  useEffect(() => {
    const id = window.setInterval(() => {
      setBars((prev) => {
        const next = prev.slice(1);
        const last = prev[prev.length - 1] ?? 40;
        next.push(Math.max(12, Math.min(92, last + (Math.random() - 0.42) * 18)));
        return next;
      });
    }, 90);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className={`flex h-28 items-end gap-[3px] sm:h-36 ${className}`}>
      {bars.map((h, i) => (
        <motion.div
          key={i}
          className="min-w-0 flex-1 rounded-t-sm bg-gradient-to-t from-violet-600/40 via-accent to-accent2/80"
          animate={{ height: `${h}%` }}
          transition={{ duration: 0.12, ease: 'linear' }}
          style={{ opacity: 0.55 + (i / bars.length) * 0.45 }}
        />
      ))}
    </div>
  );
}
