'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export type AccordionTool = {
  id: string;
  name: string;
  category: string;
  description: string;
  live?: boolean;
};

export const LANDING_TOOLS: AccordionTool[] = [
  {
    id: 'slack',
    name: 'Slack',
    category: 'Comms',
    description: 'Critical context is buried in threads, disconnected from work — Nexora surfaces and acts on it.',
    live: true,
  },
  {
    id: 'gmail',
    name: 'Gmail',
    category: 'Email',
    description: 'Unread threads pile up. Nexora drafts replies and routes follow-ups automatically.',
  },
  {
    id: 'notion',
    name: 'Notion',
    category: 'Docs',
    description: 'Docs, launch plans, and knowledge stay siloed — until one OS can write and retrieve across them.',
    live: true,
  },
  {
    id: 'jira',
    name: 'Jira',
    category: 'Dev',
    description: "Tickets sit isolated. Developers don't see the business why — Nexora bridges the gap.",
  },
  {
    id: 'zoom',
    name: 'Zoom',
    category: 'Meetings',
    description: 'Meeting decisions vanish after the call. Capture, summarize, and execute next steps.',
  },
  {
    id: 'asana',
    name: 'Asana',
    category: 'Tasks',
    description: 'Projects move forward, but context stays behind in comments. Nexora keeps both aligned.',
  },
  {
    id: 'm365',
    name: 'Microsoft 365',
    category: 'Suite',
    description: 'SharePoint mazes where key decisions hide. Bring Office work into one execution layer.',
  },
  {
    id: 'discord',
    name: 'Discord',
    category: 'Community',
    description: 'Community signal is noisy. Route the right messages into workflows your team can trust.',
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    category: 'CRM',
    description: 'Pipeline data sits apart from the tools that close deals. Connect CRM to real execution.',
  },
];

function SlackMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path fill="#E01E5A" d="M5.1 15.2a2.05 2.05 0 1 1-2.05-2.05h2.05v2.05Z" />
      <path fill="#E01E5A" d="M6.15 15.2a2.05 2.05 0 1 1 4.1 0v5.13a2.05 2.05 0 1 1-4.1 0V15.2Z" />
      <path fill="#36C5F0" d="M8.8 5.1A2.05 2.05 0 1 1 10.85 3.05V5.1H8.8Z" />
      <path fill="#36C5F0" d="M8.8 6.15a2.05 2.05 0 1 1 0 4.1H3.67a2.05 2.05 0 1 1 0-4.1H8.8Z" />
      <path fill="#2EB67D" d="M18.9 8.8a2.05 2.05 0 1 1 2.05 2.05H18.9V8.8Z" />
      <path fill="#2EB67D" d="M17.85 8.8a2.05 2.05 0 1 1-4.1 0V3.67a2.05 2.05 0 1 1 4.1 0V8.8Z" />
      <path fill="#ECB22E" d="M15.2 18.9a2.05 2.05 0 1 1-2.05 2.05V18.9H15.2Z" />
      <path fill="#ECB22E" d="M15.2 17.85a2.05 2.05 0 1 1 0-4.1h5.13a2.05 2.05 0 1 1 0 4.1H15.2Z" />
    </svg>
  );
}

function GmailMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path fill="#EA4335" d="M3.5 6.5v11l4.2-3.15V9.35L3.5 6.5Z" />
      <path fill="#34A853" d="M20.5 6.5v11l-4.2-3.15V9.35L20.5 6.5Z" />
      <path fill="#FBBC04" d="M3.5 17.5 7.7 14.35 12 17.5l4.3-3.15L20.5 17.5v1.2c0 .7-.55 1.3-1.25 1.3H4.75c-.7 0-1.25-.6-1.25-1.3v-1.2Z" />
      <path fill="#C5221F" d="M20.5 6.5 12 12.5 3.5 6.5l.9-.9L12 10.7l7.6-5.1.9.9Z" />
      <path fill="#4285F4" d="M3.5 6.5 12 12.5l8.5-6V5.3c0-.7-.55-1.3-1.25-1.3H4.75C4.05 4 3.5 4.6 3.5 5.3v1.2Z" />
    </svg>
  );
}

function NotionMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="#fff"
        d="M4.5 4.2c.35-.3.85-.45 1.55-.45h11.2c.3 0 .55.05.75.15l.35.2.2.25v14.8c0 .35-.1.65-.3.9-.2.25-.5.4-.9.45l-10.7 1.55c-.1.02-.2.02-.3.02-.45 0-.8-.15-1.05-.45-.25-.3-.4-.7-.4-1.15V5.1c0-.4.15-.7.4-.9Zm2.2 1.55v11.85l8.85-1.25V5.75H6.7Z"
      />
    </svg>
  );
}

function JiraMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path fill="#2684FF" d="M12.4 3H21v.2c0 3.8-3.1 6.9-6.9 6.9H12.4V3Zm-1.8 5.9H3v.2c0 3.8 3.1 6.9 6.9 6.9h1.7V8.9Zm1.8 5.9h-1.7c-3.8 0-6.9 3.1-6.9 6.9V22h8.6v-7.2Z" />
    </svg>
  );
}

function ZoomMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect x="2" y="6" width="14" height="12" rx="3" fill="#2D8CFF" />
      <path fill="#2D8CFF" d="M17 9.2 22 6.5v11l-5-2.7V9.2Z" />
    </svg>
  );
}

function AsanaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <circle cx="12" cy="6.5" r="3.2" fill="#F06A6A" />
      <circle cx="6.8" cy="15.5" r="3.2" fill="#F06A6A" />
      <circle cx="17.2" cy="15.5" r="3.2" fill="#F06A6A" />
    </svg>
  );
}

function M365Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path fill="#F25022" d="M3 3h8.5v8.5H3V3Z" />
      <path fill="#7FBA00" d="M12.5 3H21v8.5h-8.5V3Z" />
      <path fill="#00A4EF" d="M3 12.5h8.5V21H3v-8.5Z" />
      <path fill="#FFB900" d="M12.5 12.5H21V21h-8.5v-8.5Z" />
    </svg>
  );
}

function DiscordMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="#5865F2"
        d="M19.3 5.2A16.4 16.4 0 0 0 15.4 4l-.2.4c1.5.4 2.9 1 4.2 1.8-1.7-1-3.6-1.7-5.6-2.1A13 13 0 0 0 12 4c-.5 0-1 .1-1.5.2-2 .4-3.9 1.1-5.6 2.1 1.3-.8 2.7-1.4 4.2-1.8L9 4A16.4 16.4 0 0 0 5 5.2C2.5 9 1.8 12.6 2.1 16.2A16.7 16.7 0 0 0 7.2 19l.6-.9c-.9-.3-1.7-.8-2.5-1.3.4.2.8.5 1.3.6 2.1 1 4.4 1.5 6.7 1.5s4.6-.5 6.7-1.5c.4-.2.9-.4 1.3-.6-.8.6-1.6 1-2.5 1.3l.6.9a16.7 16.7 0 0 0 5.1-2.8c.5-4-.3-7.5-2.2-11ZM9.3 14.4c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8 1.7.8 1.6 1.8-.7 1.8-1.6 1.8Zm5.4 0c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8 1.7.8 1.6 1.8-.7 1.8-1.6 1.8Z"
      />
    </svg>
  );
}

function SalesforceMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="#00A1E0"
        d="M10.2 6.4c.7-1.2 2-2 3.5-2 1.6 0 3 .9 3.7 2.2.7-.4 1.5-.6 2.3-.6 2.3 0 4.1 1.9 4.1 4.2 0 2.3-1.8 4.2-4.1 4.2h-.2c-.5 1.7-2.1 3-4 3-1 0-1.9-.3-2.6-.9-.7.9-1.8 1.5-3.1 1.5-1.4 0-2.7-.8-3.4-2-.5.2-1 .3-1.6.3-2.2 0-4-1.8-4-4 0-1.7 1.1-3.2 2.6-3.7.4-1.4 1.8-2.5 3.6-2.5 1.2 0 2.3.5 3.2 1.3Z"
      />
    </svg>
  );
}

const LOGOS: Record<string, (p: { className?: string }) => JSX.Element> = {
  slack: SlackMark,
  gmail: GmailMark,
  notion: NotionMark,
  jira: JiraMark,
  zoom: ZoomMark,
  asana: AsanaMark,
  m365: M365Mark,
  discord: DiscordMark,
  salesforce: SalesforceMark,
};

/**
 * Gaprio-style horizontal accordion — collapsed strips expand on hover.
 */
export function IntegrationAccordion({ tools = LANDING_TOOLS }: { tools?: AccordionTool[] }) {
  const [active, setActive] = useState(0);

  return (
    <div className="w-full overflow-x-auto pb-2">
      <div
        className="flex h-[320px] min-w-[720px] gap-2 sm:h-[380px] sm:min-w-0 sm:gap-2.5 md:min-w-full"
        onMouseLeave={() => setActive(0)}
      >
      {tools.map((tool, i) => {
        const open = active === i;
        const Logo = LOGOS[tool.id] ?? SlackMark;
        return (
          <motion.button
            key={tool.id}
            type="button"
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            layout
            className={cn(
              'relative overflow-hidden rounded-[22px] border text-left transition-colors',
              open
                ? 'border-amber-400/50 bg-[#0c0e14] shadow-[0_0_40px_rgba(245,185,93,0.12)]'
                : 'border-white/10 bg-white/[0.03] hover:border-white/20'
            )}
            animate={{ flexGrow: open ? 4.2 : 1, flexBasis: 0 }}
            transition={{ duration: 0.62, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* collapsed vertical label */}
            <div
              className={cn(
                'absolute inset-0 flex flex-col items-center justify-end gap-3 pb-5 transition-opacity duration-700 ease-out',
                open ? 'pointer-events-none opacity-0' : 'opacity-100'
              )}
            >
              <div className="h-8 w-8">
                <Logo className="h-full w-full" />
              </div>
              <span
                className="origin-center text-[10px] font-semibold uppercase tracking-[0.22em] text-neutral-400"
                style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
              >
                {tool.name}
              </span>
            </div>

            {/* expanded panel */}
            <div
              className={cn(
                'absolute inset-0 flex flex-col justify-between p-5 transition-opacity duration-700 ease-out delay-100 sm:p-6',
                open ? 'opacity-100' : 'pointer-events-none opacity-0'
              )}
            >
              <div className="flex items-start justify-between">
                <span className="rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300">
                  {tool.category}
                </span>
                {tool.live && (
                  <span className="rounded-full bg-accent2/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-accent2">
                    Live
                  </span>
                )}
              </div>

              <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-[0.07]">
                <div className="h-40 w-40 sm:h-48 sm:w-48">
                  <Logo className="h-full w-full" />
                </div>
              </div>

              <div className="relative">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 shrink-0">
                    <Logo className="h-full w-full" />
                  </div>
                  <div className="font-display text-xl font-semibold text-white sm:text-2xl">{tool.name}</div>
                </div>
                <p className="mt-3 max-w-sm text-sm leading-6 text-neutral-400">{tool.description}</p>
              </div>
            </div>
          </motion.button>
        );
        })}
      </div>
    </div>
  );
}
