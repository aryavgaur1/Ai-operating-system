'use client';

import { motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';

/** Tool nodes orbiting a stylized global map — Gaprio-inspired, Nexora-branded */
const NODES = [
  { id: 'slack', label: 'Slack', x: 22, y: 34 },
  { id: 'notion', label: 'Notion', x: 72, y: 26 },
  { id: 'jira', label: 'Jira', x: 82, y: 52 },
  { id: 'gmail', label: 'Gmail', x: 16, y: 58 },
  { id: 'salesforce', label: 'Salesforce', x: 68, y: 74 },
  { id: 'github', label: 'GitHub', x: 34, y: 78 },
  { id: 'drive', label: 'Drive', x: 48, y: 18 },
  { id: 'linear', label: 'Linear', x: 58, y: 86 },
  { id: 'discord', label: 'Discord', x: 88, y: 38 },
  { id: 'hubspot', label: 'HubSpot', x: 10, y: 42 },
];

/** Approximate landmass “dots” for a soft world-map silhouette (equirectangular-ish) */
const LAND = [
  [18, 32], [20, 36], [22, 40], [24, 34], [28, 38], [30, 42], [32, 36], // Americas
  [26, 48], [28, 52], [22, 54], [34, 50],
  [48, 30], [50, 28], [52, 32], [54, 36], [56, 30], [58, 34], // Europe
  [60, 38], [62, 42], [64, 36], [66, 40], [68, 44], [70, 38], // Asia
  [72, 42], [74, 46], [76, 40], [78, 48], [80, 44], [82, 50],
  [54, 52], [56, 56], [58, 60], [52, 58], // Africa
  [78, 62], [80, 66], [82, 70], [84, 64], // Oceania
  [40, 70], [42, 74], [38, 72],
];

const ORBIT_RINGS = [28, 38, 46];

export function GlobalNetwork() {
  const [active, setActive] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setActive((a) => (a + 1) % NODES.length);
      setTick((t) => t + 1);
    }, 1600);
    return () => window.clearInterval(id);
  }, []);

  const beams = useMemo(() => {
    const hub = { x: 50, y: 48 };
    return NODES.map((n, i) => ({
      from: n,
      to: hub,
      delay: i * 0.1,
      live: i === active,
    }));
  }, [active]);

  const particles = useMemo(
    () =>
      Array.from({ length: 48 }, (_, i) => ({
        x: (i * 17) % 100,
        y: (i * 29 + 13) % 100,
        s: 0.4 + (i % 3) * 0.25,
        d: (i % 7) * 0.35,
      })),
    []
  );

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[520px]">
      {/* outer glow */}
      <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_center,rgba(91,157,255,0.22),transparent_58%)]" />
      <motion.div
        className="absolute inset-[4%] rounded-full border border-accent/20"
        animate={{ rotate: 360 }}
        transition={{ duration: 80, repeat: Infinity, ease: 'linear' }}
      />
      <motion.div
        className="absolute inset-[10%] rounded-full border border-dashed border-white/10"
        animate={{ rotate: -360 }}
        transition={{ duration: 110, repeat: Infinity, ease: 'linear' }}
      />

      {/* globe disk — landmass spins 360° continuously */}
      <div className="absolute inset-[12%] overflow-hidden rounded-full border border-white/12 bg-[radial-gradient(circle_at_32%_28%,rgba(91,157,255,0.16),transparent_42%),radial-gradient(circle_at_70%_70%,rgba(139,233,208,0.08),transparent_40%),linear-gradient(165deg,#0a1020_0%,#05060a_70%)] shadow-[0_0_100px_rgba(91,157,255,0.18),inset_0_0_60px_rgba(0,0,0,0.55)]">
        {particles.map((p, i) => (
          <motion.span
            key={i}
            className="absolute rounded-full bg-white"
            style={{ left: `${p.x}%`, top: `${p.y}%`, width: p.s, height: p.s }}
            animate={{ opacity: [0.15, 0.7, 0.15] }}
            transition={{ duration: 2.4 + p.d, repeat: Infinity, delay: p.d }}
          />
        ))}

        <motion.div
          className="absolute inset-0"
          animate={{ rotate: 360 }}
          transition={{ duration: 32, repeat: Infinity, ease: 'linear' }}
        >
          <svg className="h-full w-full" viewBox="0 0 100 100" aria-hidden>
            {[16, 26, 36, 44].map((ry) => (
              <ellipse
                key={ry}
                cx="50"
                cy="50"
                rx={ry * 0.95}
                ry={ry * 0.55}
                fill="none"
                stroke="rgba(255,255,255,0.1)"
                strokeWidth="0.25"
              />
            ))}
            {[0, 25, 50, 75, 100, 125, 150].map((deg) => {
              const rad = (deg * Math.PI) / 180;
              return (
                <line
                  key={deg}
                  x1={50 - Math.cos(rad) * 42}
                  y1={50 - Math.sin(rad) * 28}
                  x2={50 + Math.cos(rad) * 42}
                  y2={50 + Math.sin(rad) * 28}
                  stroke="rgba(255,255,255,0.06)"
                  strokeWidth="0.2"
                />
              );
            })}
            {LAND.map(([x, y], i) => (
              <circle
                key={`${x}-${y}-${i}`}
                cx={x}
                cy={y}
                r={1.15 + (i % 3) * 0.25}
                fill="rgba(200,220,255,0.45)"
              />
            ))}
            {ORBIT_RINGS.map((r) => (
              <circle
                key={r}
                cx="50"
                cy="50"
                r={r * 0.55}
                fill="none"
                stroke="rgba(139,233,208,0.12)"
                strokeWidth="0.2"
                strokeDasharray="1.5 2.5"
              />
            ))}
          </svg>
        </motion.div>

        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" aria-hidden>
          <defs>
            <linearGradient id="nexoraBeam" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#5b9dff" stopOpacity="0.05" />
              <stop offset="50%" stopColor="#8be9d0" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#5b9dff" stopOpacity="0.05" />
            </linearGradient>
            <filter id="glow">
              <feGaussianBlur stdDeviation="0.6" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {beams.map((b) => (
            <g key={b.from.id}>
              <motion.line
                x1={b.from.x}
                y1={b.from.y}
                x2={b.to.x}
                y2={b.to.y}
                stroke="url(#nexoraBeam)"
                strokeWidth={b.live ? 0.7 : 0.35}
                strokeLinecap="round"
                filter="url(#glow)"
                animate={{ opacity: b.live ? [0.35, 1, 0.35] : [0.12, 0.35, 0.12] }}
                transition={{ duration: 2.2, repeat: Infinity, delay: b.delay }}
              />
              <motion.circle
                r={b.live ? 1.4 : 0.9}
                fill={b.live ? '#8be9d0' : '#5b9dff'}
                filter="url(#glow)"
                animate={{
                  cx: [b.from.x, b.to.x, b.from.x],
                  cy: [b.from.y, b.to.y, b.from.y],
                  opacity: [0, 1, 0],
                }}
                transition={{
                  duration: b.live ? 1.8 : 3.4,
                  repeat: Infinity,
                  delay: b.delay + (tick % 2) * 0.05,
                  ease: 'easeInOut',
                }}
              />
            </g>
          ))}
          <motion.circle
            cx="50"
            cy="48"
            r="6"
            fill="rgba(91,157,255,0.2)"
            animate={{ r: [6, 9, 6], opacity: [0.45, 0.15, 0.45] }}
            transition={{ duration: 2.8, repeat: Infinity }}
          />
          <circle cx="50" cy="48" r="2.8" fill="#5b9dff" filter="url(#glow)" />
          <circle cx="50" cy="48" r="1.2" fill="#fff" opacity="0.9" />
        </svg>
      </div>

      {/* floating tool labels */}
      {NODES.map((n, i) => {
        const isActive = i === active;
        return (
          <motion.div
            key={n.id}
            className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${n.x}%`, top: `${n.y}%` }}
            animate={{ y: [0, -5, 0], scale: isActive ? 1.08 : 1 }}
            transition={{ duration: 3.2 + i * 0.1, repeat: Infinity, repeatType: 'mirror' }}
          >
            <div
              className={`rounded-full border px-2.5 py-1 text-[10px] font-medium tracking-wide shadow-soft backdrop-blur-md transition ${
                isActive
                  ? 'border-accent2/50 bg-accent2/15 text-white'
                  : 'border-white/15 bg-black/55 text-neutral-200'
              }`}
            >
              <span
                className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${
                  isActive ? 'bg-accent2 shadow-[0_0_8px_#8be9d0]' : 'bg-accent/70'
                }`}
              />
              {n.label}
            </div>
          </motion.div>
        );
      })}

      <div className="absolute bottom-0 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-black/50 px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-neutral-400 backdrop-blur">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent2 opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent2" />
        </span>
        Global sync · {NODES[active]?.label}
      </div>
    </div>
  );
}
