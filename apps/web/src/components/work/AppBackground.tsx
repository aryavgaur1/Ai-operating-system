'use client';

/** Calm, static backdrop for signed-in app chrome — no animated blobs. */
export function AppBackground() {
  return (
    <div className="app-bg" aria-hidden>
      <div className="app-bg-grid" />
    </div>
  );
}
