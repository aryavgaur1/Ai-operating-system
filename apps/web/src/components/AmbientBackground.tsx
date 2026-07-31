'use client';

export function AmbientBackground() {
  return (
    <div className="ambient-bg" aria-hidden>
      <div
        className="ambient-blob animate-floatSlow"
        style={{
          left: '6%',
          top: '-8%',
          width: 520,
          height: 520,
          background: 'radial-gradient(circle, rgba(91,157,255,0.32), transparent 70%)',
        }}
      />
      <div
        className="ambient-blob animate-floatSlower"
        style={{
          right: '2%',
          top: '10%',
          width: 620,
          height: 620,
          background: 'radial-gradient(circle, rgba(139,233,208,0.22), transparent 70%)',
        }}
      />
      <div
        className="ambient-blob animate-floatSlow"
        style={{
          left: '30%',
          bottom: '-15%',
          width: 700,
          height: 700,
          background: 'radial-gradient(circle, rgba(167,139,250,0.18), transparent 70%)',
          animationDelay: '-6s',
        }}
      />
      <div className="ambient-grid" />
      <div className="absolute inset-0 bg-noise mix-blend-overlay opacity-40" />
    </div>
  );
}
