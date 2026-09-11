'use client';

import { useId } from 'react';
import { cn } from '@/lib/utils';

type MarkVariant = 'corner' | 'fold' | 'cut' | 'signal' | 'node';

export function NexoraMark({
  className,
  variant = 'corner',
  title = 'Nexora',
}: {
  className?: string;
  variant?: MarkVariant;
  title?: string;
}) {
  const uid = useId();
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label={title}>
      <title>{title}</title>
      {variant === 'corner' && <CornerMark uid={uid} />}
      {variant === 'fold' && <FoldMark uid={uid} />}
      {variant === 'cut' && <CutMark />}
      {variant === 'signal' && <SignalMark />}
      {variant === 'node' && <NodeMark uid={uid} />}
    </svg>
  );
}

export function NexoraLockup({
  className,
  markClassName,
  wordmark = 'Nexora',
}: {
  className?: string;
  markClassName?: string;
  wordmark?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <NexoraMark className={cn('h-8 w-8 shrink-0', markClassName)} />
      <span className="font-display text-[15px] font-semibold tracking-tight text-white">{wordmark}</span>
    </span>
  );
}

function CornerMark({ uid }: { uid: string }) {
  const clip = `nxClip-${uid}`;
  return (
    <>
      <defs>
        <clipPath id={clip}>
          <rect width="64" height="64" rx="14" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect width="64" height="64" fill="#111318" />
        <path fill="#5EEAD4" d="M0 0h22L0 22Z" />
        <path fill="#F3F5F8" d="M19 47V17h8.1L38.6 35.4V17H46v30h-8.1L26.5 28.6V47H19Z" />
      </g>
    </>
  );
}

function FoldMark({ uid }: { uid: string }) {
  return (
    <>
      <defs>
        <linearGradient id={`nxFold-${uid}`} x1="10" y1="54" x2="54" y2="10" gradientUnits="userSpaceOnUse">
          <stop stopColor="#5B9DFF" />
          <stop offset="1" stopColor="#A78BFA" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="#0B0D12" />
      <path fill={`url(#nxFold-${uid})`} d="M18 48V16h8.4l11.2 18.4V16H46v32h-8.4L26.4 29.6V48H18Z" />
    </>
  );
}

function CutMark() {
  return (
    <>
      <rect width="64" height="64" rx="16" fill="#5B9DFF" />
      <path fill="#07080E" d="M20 46V18h7.6l10.4 16.8V18H44v28h-7.6L26 29.2V46H20Z" />
    </>
  );
}

function SignalMark() {
  return (
    <>
      <rect width="64" height="64" rx="32" fill="#0B0D12" />
      <rect x="1.5" y="1.5" width="61" height="61" rx="30.5" fill="none" stroke="#1E293B" strokeWidth="3" />
      <path
        d="M22 44V20M42 44V20M22 20l20 24"
        fill="none"
        stroke="#E8EEF9"
        strokeWidth="6"
        strokeLinecap="square"
      />
    </>
  );
}

function NodeMark({ uid }: { uid: string }) {
  return (
    <>
      <defs>
        <linearGradient id={`nxNode-${uid}`} x1="16" y1="48" x2="48" y2="16" gradientUnits="userSpaceOnUse">
          <stop stopColor="#5B9DFF" />
          <stop offset="1" stopColor="#A78BFA" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="#0B0D12" />
      <path
        d="M22 46V18M42 46V18M22 18l20 28"
        fill="none"
        stroke={`url(#nxNode-${uid})`}
        strokeWidth="4"
        strokeLinecap="square"
      />
      <circle cx="22" cy="18" r="3.2" fill="#5B9DFF" />
      <circle cx="42" cy="18" r="3.2" fill="#A78BFA" />
      <circle cx="22" cy="46" r="3.2" fill="#5B9DFF" />
      <circle cx="42" cy="46" r="3.2" fill="#A78BFA" />
    </>
  );
}
