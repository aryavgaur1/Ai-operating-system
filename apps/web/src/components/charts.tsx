'use client';

import { useEffect, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, RadialBar, RadialBarChart, ResponsiveContainer } from 'recharts';

const sparkBase = [
  { v: 12 }, { v: 18 }, { v: 14 }, { v: 22 }, { v: 19 }, { v: 27 }, { v: 24 },
  { v: 31 }, { v: 28 }, { v: 36 }, { v: 33 }, { v: 41 }, { v: 38 }, { v: 46 },
];

export function SparkArea({ color = '#5b9dff' }: { color?: string }) {
  const gradientId = `spark-${color.replace('#', '')}`;
  const [data, setData] = useState(sparkBase);

  useEffect(() => {
    const id = window.setInterval(() => {
      setData((prev) => {
        const next = prev.slice(1);
        const last = prev[prev.length - 1]?.v ?? 30;
        next.push({
          v: Math.max(10, Math.min(52, last + (Math.random() - 0.45) * 10)),
        });
        return next;
      });
    }, 320);
    return () => window.clearInterval(id);
  }, []);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.45} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={`url(#${gradientId})`} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

const barBase = [
  { d: 'Mon', v: 24 }, { d: 'Tue', v: 40 }, { d: 'Wed', v: 32 }, { d: 'Thu', v: 51 },
  { d: 'Fri', v: 44 }, { d: 'Sat', v: 20 }, { d: 'Sun', v: 28 },
];

export function WeekBars({ color = '#8be9d0' }: { color?: string }) {
  const [data, setData] = useState(barBase);

  useEffect(() => {
    const id = window.setInterval(() => {
      setData((prev) =>
        prev.map((row, i) => {
          // Wave through the week so bars rise/fall continuously
          const wave = Math.sin(Date.now() / 520 + i * 0.85) * 8;
          const jitter = (Math.random() - 0.5) * 4;
          const base = barBase[i]?.v ?? 30;
          return {
            ...row,
            v: Math.max(12, Math.min(62, Math.round(base + wave + jitter))),
          };
        })
      );
    }, 280);
    return () => window.clearInterval(id);
  }, []);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
        <Bar
          dataKey="v"
          radius={[6, 6, 6, 6]}
          fill={color}
          fillOpacity={0.85}
          isAnimationActive
          animationDuration={260}
          animationEasing="ease-out"
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function RiskRadial({ value, color = '#f5b95d' }: { value: number; color?: string }) {
  const data = [{ name: 'risk', value, fill: color }];
  return (
    <div className="relative h-full w-full">
      <div
        className="pointer-events-none absolute inset-[-6%] animate-risk-orbit rounded-full opacity-70"
        style={{
          background: `conic-gradient(from 0deg, transparent 0%, ${color}55 35%, transparent 70%)`,
        }}
      />
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          innerRadius="70%"
          outerRadius="100%"
          data={data}
          startAngle={90}
          endAngle={90 - 360 * (Math.max(0, Math.min(100, value)) / 100)}
          barSize={10}
        >
          <RadialBar
            background={{ fill: 'rgba(255,255,255,0.06)' }}
            dataKey="value"
            cornerRadius={10}
            isAnimationActive
            animationBegin={80}
            animationDuration={1100}
            animationEasing="ease-out"
          />
        </RadialBarChart>
      </ResponsiveContainer>
    </div>
  );
}
