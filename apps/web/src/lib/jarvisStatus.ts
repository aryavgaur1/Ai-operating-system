/**
 * User-facing Jarvis status lines derived from real agent/tool activity.
 */

import type { NexoraAgentState } from '@/components/NexoraPresence';
import { humanToolLabel, humanToolStart } from '@/lib/humanizeTools';
import { dayPartFromHour, JARVIS_SUGGESTIONS } from '@/lib/jarvisGreeting';

export function jarvisStatusLabel(
  state: NexoraAgentState,
  opts: { tool?: string; action?: string; custom?: string | null } = {}
): string {
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

export type JarvisSuggestion = { id: string; label: string; prompt: string; icon: 'mail' | 'work' | 'today' | 'slack' | 'jira' };

/** Context-aware suggestions — day part + optional route hint. Never invents inbox data. */
export function buildContextualSuggestions(opts: {
  hour?: number;
  pathname?: string | null;
}): JarvisSuggestion[] {
  const hour = typeof opts.hour === 'number' ? opts.hour : new Date().getHours();
  const part = dayPartFromHour(hour);
  const path = opts.pathname || '';

  const base: JarvisSuggestion[] = [
    { id: 'priority-email', label: 'Find important emails', prompt: 'Find my top priority emails.', icon: 'mail' },
    { id: 'pending-work', label: 'Show pending work', prompt: 'Show my pending approvals and what needs attention.', icon: 'work' },
    { id: 'important-today', label: "What's important today?", prompt: "What's important for me today across email and approvals?", icon: 'today' },
  ];

  if (/approvals/i.test(path)) {
    return [
      { id: 'pending-approvals', label: 'Show pending approvals', prompt: 'Show my pending approvals.', icon: 'work' },
      base[0],
      base[2],
    ];
  }
  if (/integrations/i.test(path)) {
    return [
      { id: 'check-gmail', label: 'Check Gmail connection', prompt: 'Is Gmail connected? Summarize my top priority emails if it is.', icon: 'mail' },
      { id: 'check-slack', label: 'Check Slack', prompt: 'Search Slack for recent mentions that need my attention.', icon: 'slack' },
      base[1],
    ];
  }
  if (/workspace|members/i.test(path)) {
    return [
      base[1],
      { id: 'jira', label: 'Open my Jira tickets', prompt: 'Show my open Jira tickets.', icon: 'jira' },
      base[0],
    ];
  }

  if (part === 'evening') {
    return [
      { id: 'summarize-day', label: "Summarize today's work", prompt: "Summarize today's work across email and approvals.", icon: 'today' },
      { id: 'tomorrow', label: "Prepare tomorrow's priorities", prompt: "What should I prioritize tomorrow based on pending work and important email?", icon: 'work' },
      base[0],
    ];
  }
  if (part === 'morning') {
    return [
      base[0],
      base[2],
      base[1],
    ];
  }

  // afternoon / default — align with JARVIS_SUGGESTIONS labels
  return base.map((b) => {
    const fromCanon = JARVIS_SUGGESTIONS.find((s) => s.id === b.id);
    return fromCanon ? { ...b, label: fromCanon.label, prompt: fromCanon.prompt } : b;
  });
}
