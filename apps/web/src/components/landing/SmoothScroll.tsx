'use client';

import { useEffect } from 'react';

/**
 * Cream-smooth scrolling for the marketing site (Lenis-like lerp without a new dependency).
 * Respects prefers-reduced-motion.
 */
export function SmoothScroll() {
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;

    let current = window.scrollY;
    let target = window.scrollY;
    let raf = 0;
    const ease = 0.055; // cream-smooth lerp (lower = silkier)

    function onWheel(e: WheelEvent) {
      // Allow native horizontal / modified scrolls
      if (e.ctrlKey) return;
      e.preventDefault();
      target += e.deltaY;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      target = Math.max(0, Math.min(max, target));
      if (!raf) raf = requestAnimationFrame(tick);
    }

    function onKey(e: KeyboardEvent) {
      const keys: Record<string, number> = {
        ArrowDown: 60,
        ArrowUp: -60,
        PageDown: window.innerHeight * 0.85,
        PageUp: -window.innerHeight * 0.85,
        ' ': window.innerHeight * 0.85,
        Home: -1e9,
        End: 1e9,
      };
      if (!(e.key in keys)) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
      e.preventDefault();
      if (e.key === 'Home') target = 0;
      else if (e.key === 'End') target = document.documentElement.scrollHeight;
      else target += keys[e.key]!;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      target = Math.max(0, Math.min(max, target));
      if (!raf) raf = requestAnimationFrame(tick);
    }

    function onScroll() {
      // External scroll (anchor, programmatic) — re-sync
      if (Math.abs(window.scrollY - current) > 2 && Math.abs(window.scrollY - target) > 8) {
        current = window.scrollY;
        target = window.scrollY;
      }
    }

    function tick() {
      current += (target - current) * ease;
      if (Math.abs(target - current) < 0.35) {
        current = target;
        window.scrollTo(0, current);
        raf = 0;
        return;
      }
      window.scrollTo(0, current);
      raf = requestAnimationFrame(tick);
    }

    // Anchor links — still cream-smooth via lerp
    function onClick(e: MouseEvent) {
      const a = (e.target as HTMLElement).closest('a[href^="#"]') as HTMLAnchorElement | null;
      if (!a) return;
      const id = a.getAttribute('href')?.slice(1);
      if (!id) return;
      const el = document.getElementById(id);
      if (!el) return;
      e.preventDefault();
      const top = el.getBoundingClientRect().top + window.scrollY - 88;
      target = top;
      if (!raf) raf = requestAnimationFrame(tick);
    }

    current = window.scrollY;
    target = window.scrollY;
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('click', onClick);

    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('click', onClick);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return null;
}
