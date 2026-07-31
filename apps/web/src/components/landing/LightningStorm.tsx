'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useId, useState } from 'react';

/**
 * Thunderstorm-style lightning: charge layer → burst → afterglow.
 */
export function LightningStorm({ className = '' }: { className?: string }) {
  const reduce = useReducedMotion();
  const uid = useId().replace(/:/g, '');
  const [phase, setPhase] = useState<'idle' | 'charge' | 'burst' | 'after'>('idle');
  const [variant, setVariant] = useState(0);

  useEffect(() => {
    if (reduce) return;
    let cancelled = false;
    let t1 = 0;
    let t2 = 0;
    let t3 = 0;
    let loop = 0;

    function cycle() {
      if (cancelled) return;
      setVariant((v) => (v + 1) % 3);
      setPhase('charge');
      t1 = window.setTimeout(() => {
        if (cancelled) return;
        setPhase('burst');
        t2 = window.setTimeout(() => {
          if (cancelled) return;
          setPhase('after');
          t3 = window.setTimeout(() => {
            if (cancelled) return;
            setPhase('idle');
            loop = window.setTimeout(cycle, 1100);
          }, 480);
        }, 160);
      }, 980);
    }

    loop = window.setTimeout(cycle, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.clearTimeout(loop);
    };
  }, [reduce]);

  const showBolt = phase === 'burst' || phase === 'after';
  const boltOpacity = phase === 'burst' ? 1 : phase === 'after' ? 0.28 : 0;
  const glowId = `boltGlow-${uid}`;
  const gradId = `boltGrad-${uid}`;
  const cloudId = `cloudGrad-${uid}`;

  const bolts = [
    // center trunk + fractal branches
    {
      main: 'M200 6 L214 38 L198 46 L224 88 L208 96 L236 150 L220 168 L248 220',
      branches: [
        'M214 38 L252 52 L244 74 L268 90',
        'M198 46 L162 58 L148 82 L156 104',
        'M224 88 L268 104 L258 132 L282 148',
        'M208 96 L172 118 L160 148 L176 172',
        'M236 150 L270 162 L262 188',
        'M220 168 L194 186 L186 208',
        'M232 70 L250 82 L246 98',
      ],
    },
    // left-leaning strike
    {
      main: 'M240 4 L228 36 L246 48 L218 90 L236 102 L204 148 L222 168 L190 220',
      branches: [
        'M228 36 L198 48 L188 72',
        'M246 48 L278 62 L292 88',
        'M218 90 L184 108 L170 136',
        'M236 102 L270 118 L284 146',
        'M204 148 L174 164 L168 192',
        'M222 168 L248 184 L242 208',
      ],
    },
    // forked dual-path
    {
      main: 'M180 8 L196 40 L182 52 L210 94 L194 108 L228 158 L212 176 L240 222',
      branches: [
        'M196 40 L230 54 L238 78 L262 96',
        'M182 52 L148 66 L136 96',
        'M210 94 L248 110 L256 140',
        'M194 108 L160 128 L152 160',
        'M228 158 L264 172 L278 198',
        'M212 176 L188 196 L178 218',
        'M200 70 L218 80 L212 96',
      ],
    },
  ] as const;

  const bolt = bolts[variant]!;

  return (
    <div className={`relative h-full min-h-[220px] w-full overflow-hidden ${className}`}>
      {/* midnight storm atmosphere */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at 50% 15%, rgba(70,40,140,0.55), transparent 50%), radial-gradient(ellipse at 75% 45%, rgba(30,70,150,0.28), transparent 45%), radial-gradient(ellipse at 25% 60%, rgba(20,30,80,0.4), transparent 40%)',
        }}
      />

      {/* billowing cloud glow */}
      <motion.div
        className="absolute inset-x-0 top-0 h-[55%]"
        style={{
          background: `radial-gradient(ellipse at 50% 80%, rgba(120,90,220,0.35), transparent 65%)`,
        }}
        animate={
          phase === 'charge'
            ? { opacity: [0.35, 0.7, 0.4, 0.85, 0.5] }
            : phase === 'burst'
              ? { opacity: 1 }
              : phase === 'after'
                ? { opacity: 0.55 }
                : { opacity: 0.25 }
        }
        transition={{ duration: phase === 'charge' ? 0.95 : 0.25 }}
      />

      {/* charge flicker bloom */}
      <motion.div
        className="absolute left-1/2 top-[18%] h-28 w-48 -translate-x-1/2 rounded-full bg-violet-300/20 blur-3xl"
        animate={
          phase === 'charge'
            ? { opacity: [0.2, 0.65, 0.3, 0.8], scale: [1, 1.12, 1.05] }
            : phase === 'burst'
              ? { opacity: 1, scale: 1.35 }
              : { opacity: 0.1, scale: 1 }
        }
        transition={{ duration: phase === 'charge' ? 0.95 : 0.18 }}
      />

      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 400 230" preserveAspectRatio="xMidYMid slice" aria-hidden>
        <defs>
          <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.8" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="35%" stopColor="#e0e7ff" />
            <stop offset="70%" stopColor="#a78bfa" />
            <stop offset="100%" stopColor="#4c1d95" stopOpacity="0.15" />
          </linearGradient>
          <radialGradient id={cloudId} cx="50%" cy="20%" r="55%">
            <stop offset="0%" stopColor="#c4b5fd" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#0a0c14" stopOpacity="0" />
          </radialGradient>
        </defs>

        <ellipse cx="200" cy="40" rx="160" ry="48" fill={`url(#${cloudId})`} />

        {/* pre-strike filaments */}
        <motion.path
          d="M188 24 L196 52 L184 58 L202 92"
          fill="none"
          stroke="#a78bfa"
          strokeWidth="1"
          strokeLinecap="round"
          animate={{ opacity: phase === 'charge' ? [0.08, 0.5, 0.12, 0.55] : 0 }}
          transition={{ duration: 0.85 }}
        />
        <motion.path
          d="M218 20 L210 48 L224 56 L214 94"
          fill="none"
          stroke="#8b5cf6"
          strokeWidth="0.85"
          animate={{ opacity: phase === 'charge' ? [0.05, 0.4, 0.1, 0.35] : 0 }}
          transition={{ duration: 0.75 }}
        />
        <motion.path
          d="M170 30 L178 58 L166 70"
          fill="none"
          stroke="#7c3aed"
          strokeWidth="0.7"
          animate={{ opacity: phase === 'charge' ? [0, 0.3, 0.05, 0.28] : 0 }}
          transition={{ duration: 0.9 }}
        />

        {/* main bolt + branches */}
        <motion.g
          filter={`url(#${glowId})`}
          animate={{ opacity: boltOpacity }}
          transition={{ duration: phase === 'burst' ? 0.04 : 0.4 }}
        >
          {/* soft outer glow stroke */}
          <path
            d={bolt.main}
            fill="none"
            stroke="#818cf8"
            strokeWidth={phase === 'burst' ? 7 : 4}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.35}
          />
          <path
            d={bolt.main}
            fill="none"
            stroke={`url(#${gradId})`}
            strokeWidth={phase === 'burst' ? 3.4 : 2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {bolt.branches.map((d, i) => (
            <path
              key={i}
              d={d}
              fill="none"
              stroke={i % 2 === 0 ? '#e9d5ff' : '#c4b5fd'}
              strokeWidth={1.4 - i * 0.08}
              strokeLinecap="round"
              opacity={phase === 'after' ? 0.55 : 1}
            />
          ))}
        </motion.g>

        {/* screen flash */}
        <motion.rect
          x="0"
          y="0"
          width="400"
          height="230"
          fill="#c4b5fd"
          animate={{ opacity: phase === 'burst' ? [0, 0.32, 0.08, 0] : 0 }}
          transition={{ duration: 0.28 }}
        />
      </svg>

      {/* residual sparks */}
      {showBolt &&
        [0, 1, 2, 3, 4, 5, 6].map((i) => (
          <motion.span
            key={`${variant}-${i}`}
            className="absolute h-1 w-1 rounded-full bg-violet-100 shadow-[0_0_8px_#c4b5fd]"
            style={{ left: `${36 + i * 7}%`, top: `${22 + (i % 4) * 16}%` }}
            animate={{ opacity: [0.9, 0], y: [0, 18 + i * 2], scale: [1, 0.3] }}
            transition={{ duration: 0.55, delay: i * 0.03 }}
          />
        ))}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#080a10] to-transparent" />
    </div>
  );
}
