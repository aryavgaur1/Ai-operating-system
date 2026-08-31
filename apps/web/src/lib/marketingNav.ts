/** Shared marketing site navigation — used by homepage, MarketingShell, and footer. */

export type MarketingNavLink = { href: string; label: string; hash?: boolean };

export const MARKETING_NAV_LINKS: MarketingNavLink[] = [
  { href: '/how-it-works', label: 'How It Works' },
  { href: '/ai-agents', label: 'AI Agents' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/integrations', label: 'Integrations' },
  { href: '/features', label: 'Features' },
];

export const MARKETING_FOOTER = [
  {
    title: 'Product',
    links: [
      { href: '/features', label: 'Features' },
      { href: '/how-it-works', label: 'How It Works' },
      { href: '/ai-agents', label: 'AI Agents' },
      { href: '/analytics', label: 'Analytics' },
      { href: '/integrations', label: 'Integrations' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/enterprise', label: 'Enterprise' },
    ],
  },
  {
    title: 'Developers',
    links: [
      { href: '/docs', label: 'Documentation' },
      { href: '/docs', label: 'API' },
      { href: '/docs', label: 'Roadmap' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/about', label: 'About' },
      { href: '/contact', label: 'Contact' },
      { href: '/privacy', label: 'Privacy' },
      { href: '/terms', label: 'Terms' },
    ],
  },
] as const;

export const MARKETING_EXPLORE_CARDS = [
  {
    href: '/how-it-works',
    eyebrow: 'How it works',
    title: 'Propose → Approve → Act',
    body: 'See how Nexora plans real actions, pauses for approval, and executes against live APIs.',
  },
  {
    href: '/ai-agents',
    eyebrow: 'AI Agents',
    title: 'Specialists on one OS',
    body: 'Purpose-built agents for Slack, Jira, Notion, and Gmail — sharing memory and approvals.',
  },
  {
    href: '/analytics',
    eyebrow: 'Analytics',
    title: 'Operator-grade visibility',
    body: 'Track action outcomes, approvals, and workspace activity from one command surface.',
  },
  {
    href: '/integrations',
    eyebrow: 'Integrations',
    title: 'Connect your stack',
    body: 'Slack, Jira, Notion, and Gmail run live today — OAuth-connected to your workspace.',
  },
] as const;
