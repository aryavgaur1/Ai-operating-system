/**
 * User-facing Jarvis status lines derived from real agent/tool activity.
 */

import type { NexoraAgentState } from '@/components/NexoraPresence';
import { humanToolLabel, humanToolStart } from '@/lib/humanizeTools';
import { dayPartFromHour, JARVIS_SUGGESTIONS } from '@/lib/jarvisGreeting';

export function jarvisStatusLabel(
  state: NexoraAgentState,
  opts: { tool?: string; action?: string; custom?: string | null; muted?: boolean } = {}
): string {
  if (opts.muted && state === 'idle') return 'Muted';
  if (opts.custom) return opts.custom;
  if (state === 'listening') return 'Listening…';
  if (state === 'thinking') return 'Understanding…';
  if (state === 'speaking') return 'Speaking…';
  if (state === 'success') return 'Completed';
  if (state === 'error') return 'Something needs attention';
  if (state === 'tool' && opts.tool) {
    return humanToolLabel(opts.tool, opts.action) + '…';
  }
  if (state === 'tool') return 'Working…';
  return 'Ready';
}

export function jarvisToolNarration(tool: string, action: string): string {
  return humanToolStart(tool, action);
}

export type JarvisSuggestion = {
  id: string;
  label: string;
  prompt: string;
  icon: 'mail' | 'work' | 'today' | 'slack' | 'jira';
  requires?: 'gmail' | 'slack' | 'jira' | 'notion' | null;
};

export type ConnectedTools = {
  gmail?: boolean;
  slack?: boolean;
  jira?: boolean;
  notion?: boolean;
};

/** Context-aware suggestions — only advertise tools that are connected. */
export function buildContextualSuggestions(opts: {
  hour?: number;
  pathname?: string | null;
  connected?: ConnectedTools | null;
}): JarvisSuggestion[] {
  const hour = typeof opts.hour === 'number' ? opts.hour : new Date().getHours();
  const part = dayPartFromHour(hour);
  const path = opts.pathname || '';
  const c = opts.connected;

  const all: JarvisSuggestion[] = [
    {
      id: 'priority-email',
      label: 'Find important emails',
      prompt: 'Find my top priority emails.',
      icon: 'mail',
      requires: 'gmail',
    },
    {
      id: 'pending-work',
      label: 'Show pending work',
      prompt: 'Show my pending approvals and what needs attention.',
      icon: 'work',
      requires: null,
    },
    {
      id: 'important-today',
      label: "What's important today?",
      prompt: "What's important for me today across email and approvals?",
      icon: 'today',
      requires: null,
    },
    {
      id: 'check-slack',
      label: 'Check Slack',
      prompt: 'Search Slack for recent mentions that need my attention.',
      icon: 'slack',
      requires: 'slack',
    },
    {
      id: 'check-jira',
      label: 'Check Jira',
      prompt: 'Show my open Jira tickets.',
      icon: 'jira',
      requires: 'jira',
    },
    {
      id: 'pending-approvals',
      label: 'Review approvals',
      prompt: 'Show my pending approvals.',
      icon: 'work',
      requires: null,
    },
    {
      id: 'summarize-day',
      label: "Summarize today's work",
      prompt: "Summarize today's work across email and approvals.",
      icon: 'today',
      requires: null,
    },
    {
      id: 'tomorrow',
      label: "Prepare tomorrow's priorities",
      prompt: 'What should I prioritize tomorrow based on pending work and important email?',
      icon: 'work',
      requires: null,
    },
  ];

  const allowed = all.filter((s) => {
    if (!s.requires) return true;
    if (!c) return true;
    return Boolean(c[s.requires]);
  });

  const pick = (ids: string[]) =>
    ids.map((id) => allowed.find((s) => s.id === id)).filter(Boolean) as JarvisSuggestion[];

  if (/approvals/i.test(path)) {
    return pick(['pending-approvals', 'priority-email', 'important-today']).slice(0, 3);
  }
  if (/integrations/i.test(path)) {
    const out = pick(['priority-email', 'check-slack', 'pending-work']);
    if (out.length) return out.slice(0, 3);
  }
  if (/workspace|members/i.test(path)) {
    return pick(['pending-work', 'check-jira', 'priority-email']).slice(0, 3);
  }
  if (part === 'evening') {
    return pick(['summarize-day', 'tomorrow', 'priority-email']).slice(0, 3);
  }
  if (part === 'morning') {
    return pick(['priority-email', 'important-today', 'pending-work']).slice(0, 3);
  }

  const base = pick(['priority-email', 'pending-work', 'important-today']);
  if (base.length) return base;
  return allowed.slice(0, 3).map((b) => {
    const fromCanon = JARVIS_SUGGESTIONS.find((s) => s.id === b.id);
    return fromCanon ? { ...b, label: fromCanon.label, prompt: fromCanon.prompt } : b;
  });
}

export function buildConnectHints(connected: ConnectedTools | null | undefined): JarvisSuggestion[] {
  if (!connected) return [];
  const hints: JarvisSuggestion[] = [];
  if (!connected.gmail) {
    hints.push({
      id: 'connect-gmail',
      label: 'Connect Gmail',
      prompt: 'Gmail is not connected. Tell me how to connect Gmail from Integrations.',
      icon: 'mail',
      requires: null,
    });
  }
  return hints;
}
