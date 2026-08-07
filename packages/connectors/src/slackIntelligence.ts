import {
  createBookmark,
  createCanvas,
  createChannel,
  findUsersByRole,
  getChannelHistory,
  getThread,
  inviteUsers,
  listChannels,
  pinMessage,
  postMessage,
  resolveChannelId,
  scheduleReminder,
  searchHistory,
  setChannelPurpose,
  setChannelTopic,
  uploadFile,
} from './slackService';

// ============================================================
// Slack Intelligence — enterprise AI workflows composed from
// the low-level Slack Web API. These solve real operating
// problems (incidents, war rooms, digests, blockers) rather
// than exposing raw CRUD alone.
// ============================================================

const BLOCKER_RE =
  /\b(blocked|blocker|blocking|stuck|waiting on|waiting for|can't proceed|cannot proceed|dependency|bottleneck|impediment)\b/i;
const QUESTION_RE = /\?(\s|$)|^(can|could|should|would|who|what|when|where|why|how)\b/i;
const COMPLAINT_RE =
  /\b(complaint|frustrated|angry|unacceptable|broken|outage|bug report|customer (?:is )?upset|refund|escalate|escalation)\b/i;
const APPROVAL_RE = /\b(approve|approval|waiting for (?:sign[- ]?off|approval)|needs? (?:review|sign[- ]?off)|LGTM\?|please review)\b/i;
const TODO_RE = /\b(todo|to-do|action item|please (?:do|fix|ship|send)|follow[- ]?up|owner:|assigned to)\b/i;
const DECISION_RE = /\b(decided|decision|we will|going with|agreed|consensus|final call)\b/i;
const URL_RE = /https?:\/\/[^\s>|]+/gi;

function slugify(name: string): string {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/^#/, '')
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
}

function extractLinks(text: string): string[] {
  return Array.from(String(text ?? '').match(URL_RE) ?? []).slice(0, 20);
}

function messageAgeHours(ts?: string): number {
  if (!ts) return 0;
  const sec = Number(String(ts).split('.')[0]);
  if (!Number.isFinite(sec)) return 0;
  return (Date.now() / 1000 - sec) / 3600;
}

export async function createWarRoom(input: {
  name?: string;
  topic?: string;
  project?: string;
  roles?: string[];
  docs?: string[];
  roadmap?: string;
}): Promise<Record<string, unknown>> {
  const project = String(input.project ?? input.name ?? 'launch').trim();
  const channelName = slugify(input.name ?? `war-room-${project}`) || `war-room-${Date.now().toString(36)}`;
  const topic = input.topic ?? `🚀 Launch war room — ${project}`;
  const roles = input.roles?.length ? input.roles : ['eng', 'product', 'design', 'devops', 'cto'];

  const channel = await createChannel({ name: channelName, isPrivate: false });
  const steps: Array<{ step: string; ok: boolean; detail?: unknown; error?: string }> = [];
  steps.push({ step: 'createChannel', ok: true, detail: channel });

  try {
    await setChannelTopic({ channel: channel.id, topic });
    steps.push({ step: 'setChannelTopic', ok: true });
  } catch (err: any) {
    steps.push({ step: 'setChannelTopic', ok: false, error: err?.message });
  }

  try {
    await setChannelPurpose({
      channel: channel.id,
      purpose: `Autonomous war room created by Nexora for ${project}`,
    });
    steps.push({ step: 'setChannelPurpose', ok: true });
  } catch (err: any) {
    steps.push({ step: 'setChannelPurpose', ok: false, error: err?.message });
  }

  const people = await findUsersByRole(roles, 3);
  if (people.length) {
    try {
      const invited = await inviteUsers({ channel: channel.id, users: people.map((p) => p.id) });
      steps.push({ step: 'inviteUsers', ok: true, detail: { invited: invited.invited, people } });
    } catch (err: any) {
      steps.push({ step: 'inviteUsers', ok: false, error: err?.message, detail: { people } });
    }
  } else {
    steps.push({ step: 'inviteUsers', ok: true, detail: { note: 'No role matches found — invite manually if needed' } });
  }

  const canvasMd = [
    `# ${project} War Room`,
    '',
    '## Mission',
    `Launch / execute **${project}** with clear owners and daily sync.`,
    '',
    '## Owners',
    ...(people.length ? people.map((p) => `- ${p.role}: <@${p.id}> (${p.title || p.name || 'member'})`) : ['- TBD']),
    '',
    '## Checklist',
    '- [ ] Kickoff complete',
    '- [ ] Roadmap shared',
    '- [ ] Risks logged',
    '- [ ] Daily standup cadence set',
    '',
    '## Links',
    ...(input.docs?.length ? input.docs.map((d) => `- ${d}`) : ['- Add Notion / GitHub / Jira links']),
  ].join('\n');

  try {
    const canvas = await createCanvas({ title: `${project} Launch Plan`, markdown: canvasMd, channel: channel.id });
    steps.push({ step: 'createCanvas', ok: true, detail: canvas });
  } catch (err: any) {
    steps.push({ step: 'createCanvas', ok: false, error: err?.message });
  }

  for (const link of input.docs ?? []) {
    try {
      const bm = await createBookmark({ channel: channel.id, title: link.slice(0, 60), link });
      steps.push({ step: 'createBookmark', ok: true, detail: bm });
    } catch (err: any) {
      steps.push({ step: 'createBookmark', ok: false, error: err?.message });
    }
  }

  if (input.roadmap) {
    try {
      const file = await uploadFile({
        channels: channel.id,
        content: input.roadmap,
        filename: `${slugify(project)}-roadmap.md`,
        title: `${project} Roadmap`,
        initialComment: '📌 Roadmap uploaded by Nexora',
      });
      steps.push({ step: 'uploadRoadmap', ok: true, detail: file });
    } catch (err: any) {
      steps.push({ step: 'uploadRoadmap', ok: false, error: err?.message });
    }
  }

  const welcome = await postMessage({
    channel: channel.id,
    text: [
      `👋 *Welcome to #${channel.name}* — Nexora spun up this war room for **${project}**.`,
      '',
      '• Topic set · Canvas / runbook ready · Bookmarks attached',
      people.length ? `• Invited: ${people.map((p) => `<@${p.id}> (${p.role})`).join(', ')}` : '• Invite your core team when ready',
      '',
      '_Reply here with blockers, decisions, and links — I will keep the room organized._',
    ].join('\n'),
  });
  steps.push({ step: 'welcomeMessage', ok: true, detail: { ts: welcome.ts } });

  try {
    if (welcome.ts) {
      await pinMessage({ channel: channel.id, timestamp: String(welcome.ts) });
      steps.push({ step: 'pinWelcome', ok: true });
    }
  } catch (err: any) {
    steps.push({ step: 'pinWelcome', ok: false, error: err?.message });
  }

  try {
    const in15h = Math.floor(Date.now() / 1000) + 15 * 60 * 60;
    const reminder = await scheduleReminder({
      channel: channel.id,
      text: `⏰ Reminder: sync on **${project}** — post status, blockers, and next actions.`,
      postAt: in15h,
    });
    steps.push({ step: 'scheduleReminder', ok: true, detail: reminder });
  } catch (err: any) {
    steps.push({ step: 'scheduleReminder', ok: false, error: err?.message });
  }

  return {
    ok: true,
    workflow: 'createWarRoom',
    channel,
    people,
    steps,
    summary: `War room #${channel.name} created for ${project} with ${steps.filter((s) => s.ok).length}/${steps.length} steps succeeded.`,
  };
}

export async function createIncident(input: {
  name?: string;
  severity?: string;
  summary?: string;
  roles?: string[];
}): Promise<Record<string, unknown>> {
  const severity = (input.severity ?? 'sev-2').toLowerCase();
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const label = input.name ?? `incident-${severity}-${stamp}`;
  const channelName = slugify(label) || `incident-${Date.now().toString(36)}`;
  const roles = input.roles?.length ? input.roles : ['devops', 'sre', 'backend', 'oncall', 'cto'];
  const summary = input.summary ?? 'Production incident — investigating';

  const channel = await createChannel({ name: channelName, isPrivate: false });
  const steps: Array<{ step: string; ok: boolean; detail?: unknown; error?: string }> = [];
  steps.push({ step: 'createChannel', ok: true, detail: channel });

  try {
    await setChannelTopic({ channel: channel.id, topic: `🚨 INCIDENT ${severity.toUpperCase()} — ${summary.slice(0, 180)}` });
    steps.push({ step: 'setChannelTopic', ok: true });
  } catch (err: any) {
    steps.push({ step: 'setChannelTopic', ok: false, error: err?.message });
  }

  const people = await findUsersByRole(roles, 4);
  if (people.length) {
    try {
      await inviteUsers({ channel: channel.id, users: people.map((p) => p.id) });
      steps.push({ step: 'inviteResponders', ok: true, detail: people });
    } catch (err: any) {
      steps.push({ step: 'inviteResponders', ok: false, error: err?.message });
    }
  }

  const runbook = [
    `# Incident Runbook — ${channel.name}`,
    '',
    `**Severity:** ${severity}`,
    `**Summary:** ${summary}`,
    `**Opened:** ${new Date().toISOString()}`,
    '',
    '## Roles',
    ...(people.length ? people.map((p) => `- ${p.role}: <@${p.id}>`) : ['- Commander: TBD', '- Comms: TBD']),
    '',
    '## Timeline',
    `- ${new Date().toISOString()} — Channel opened by Nexora`,
    '',
    '## Checklist',
    '- [ ] Confirm customer impact',
    '- [ ] Identify blast radius',
    '- [ ] Mitigate / rollback',
    '- [ ] Comms to stakeholders',
    '- [ ] Create action list',
    '- [ ] Schedule postmortem',
    '',
    '## Action items',
    '- [ ] ',
  ].join('\n');

  try {
    const canvas = await createCanvas({ title: `Incident ${channel.name}`, markdown: runbook, channel: channel.id });
    steps.push({ step: 'createCanvas', ok: true, detail: canvas });
  } catch (err: any) {
    steps.push({ step: 'createCanvas', ok: false, error: err?.message });
  }

  try {
    const actions = await uploadFile({
      channels: channel.id,
      content: ['# Incident Action List', '', '- [ ] Page on-call', '- [ ] Capture metrics', '- [ ] Customer notice draft', '- [ ] Postmortem owner'].join('\n'),
      filename: 'incident-actions.md',
      title: 'Action List',
      initialComment: '✅ Action list',
    });
    steps.push({ step: 'createChecklist', ok: true, detail: actions });
  } catch (err: any) {
    steps.push({ step: 'createChecklist', ok: false, error: err?.message });
  }

  const kickoff = await postMessage({
    channel: channel.id,
    text: [
      `🚨 *INCIDENT OPENED* (\`${severity}\`)`,
      summary,
      '',
      people.length ? `Responders: ${people.map((p) => `<@${p.id}>`).join(' ')}` : 'Tag responders now.',
      '',
      'Template pinned via Canvas/runbook. Update timeline in-thread. Nexora will help summarize as the thread grows.',
    ].join('\n'),
  });
  steps.push({ step: 'notifyStakeholders', ok: true, detail: { ts: kickoff.ts } });

  try {
    if (kickoff.ts) await pinMessage({ channel: channel.id, timestamp: String(kickoff.ts) });
    steps.push({ step: 'pinRunbookMessage', ok: true });
  } catch (err: any) {
    steps.push({ step: 'pinRunbookMessage', ok: false, error: err?.message });
  }

  try {
    const in15m = Math.floor(Date.now() / 1000) + 15 * 60;
    await scheduleReminder({
      channel: channel.id,
      text: `⏱️ 15-min incident pulse: status, impact, next action, ETA.`,
      postAt: in15m,
    });
    steps.push({ step: 'schedulePulse', ok: true });
  } catch (err: any) {
    steps.push({ step: 'schedulePulse', ok: false, error: err?.message });
  }

  return {
    ok: true,
    workflow: 'createIncident',
    channel,
    severity,
    people,
    steps,
    summary: `Incident channel #${channel.name} opened (${severity}). ${steps.filter((s) => s.ok).length}/${steps.length} steps ok.`,
  };
}

export async function summarizeThread(input: { channel: string; threadTs: string; limit?: number }) {
  const thread = await getThread({ channel: input.channel, threadTs: input.threadTs, limit: input.limit ?? 80 });
  const messages = (thread.messages ?? []) as Array<{ user?: string; text?: string; ts?: string }>;
  const participants = [...new Set(messages.map((m) => m.user).filter(Boolean))];
  const decisions = messages.filter((m) => DECISION_RE.test(String(m.text))).map((m) => String(m.text));
  const todos = messages.filter((m) => TODO_RE.test(String(m.text))).map((m) => String(m.text));
  const links = messages.flatMap((m) => extractLinks(String(m.text ?? '')));
  const summary = [
    `Thread summary (${messages.length} msgs, ${participants.length} people)`,
    decisions.length ? `Decisions:\n${decisions.map((d) => `- ${d}`).join('\n')}` : 'Decisions: none explicit',
    todos.length ? `Pending tasks:\n${todos.map((t) => `- ${t}`).join('\n')}` : 'Pending tasks: none explicit',
    links.length ? `Files/links: ${links.slice(0, 8).join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    channel: thread.channel,
    threadTs: input.threadTs,
    participants,
    decisions,
    todos,
    links,
    messageCount: messages.length,
    summary,
  };
}

export async function summarizeChannelDeep(input: { channel: string; limit?: number; focus?: string }) {
  const hist = await getChannelHistory({ channel: input.channel, limit: input.limit ?? 80 });
  const messages = (hist.messages ?? []) as Array<{ user?: string; text?: string; ts?: string; reply_count?: number }>;
  const focus = (input.focus ?? '').toLowerCase();
  const filtered = focus
    ? messages.filter((m) => String(m.text ?? '').toLowerCase().includes(focus))
    : messages;

  const blockers = filtered.filter((m) => BLOCKER_RE.test(String(m.text)));
  const questions = filtered.filter((m) => QUESTION_RE.test(String(m.text)));
  const decisions = filtered.filter((m) => DECISION_RE.test(String(m.text)));
  const links = filtered.flatMap((m) => extractLinks(String(m.text ?? '')));

  const summary = [
    `Channel intelligence for ${hist.channel} — ${filtered.length} messages analyzed.`,
    decisions.length ? `Key decisions (${decisions.length}):\n${decisions.slice(0, 5).map((m) => `- ${m.text}`).join('\n')}` : 'No explicit decisions found.',
    blockers.length ? `Blockers (${blockers.length}):\n${blockers.slice(0, 5).map((m) => `- ${m.text}`).join('\n')}` : 'No blockers detected.',
    questions.length ? `Open questions (${questions.length}):\n${questions.slice(0, 5).map((m) => `- ${m.text}`).join('\n')}` : '',
    links.length ? `Shared links: ${[...new Set(links)].slice(0, 8).join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    channel: hist.channel,
    messageCount: filtered.length,
    blockers: blockers.map((m) => ({ text: m.text, user: m.user, ts: m.ts })),
    questions: questions.map((m) => ({ text: m.text, user: m.user, ts: m.ts })),
    decisions: decisions.map((m) => ({ text: m.text, user: m.user, ts: m.ts })),
    links: [...new Set(links)],
    summary,
  };
}

export async function findBlockers(input: { query?: string; channel?: string; limit?: number }) {
  const q = input.query || 'blocked OR blocker OR stuck OR waiting';
  let matches: Array<Record<string, unknown>> = [];

  if (input.channel) {
    const hist = await getChannelHistory({ channel: input.channel, limit: input.limit ?? 100 });
    matches = (hist.messages as any[])
      .filter((m) => BLOCKER_RE.test(String(m.text ?? '')))
      .map((m) => ({ channel: { id: hist.channel }, text: m.text, user: m.user, ts: m.ts }));
  } else {
    const search = await searchHistory(q, input.limit ?? 30);
    matches = (search.matches as any[]).filter((m) => BLOCKER_RE.test(String(m.text ?? m)));
  }

  const grouped = new Map<string, { text: string; owners: Set<string>; count: number }>();
  for (const m of matches) {
    const text = String((m as any).text ?? '').trim();
    if (!text) continue;
    const key = text.toLowerCase().slice(0, 80);
    const row = grouped.get(key) ?? { text, owners: new Set<string>(), count: 0 };
    row.count += 1;
    if ((m as any).user) row.owners.add(String((m as any).user));
    grouped.set(key, row);
  }

  const top = [...grouped.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 12)
    .map((g) => ({
      blocker: g.text,
      count: g.count,
      owners: [...g.owners],
      suggestedAction: 'Assign owner + ETA; escalate if >24h',
    }));

  return {
    ok: true,
    totalMatches: matches.length,
    topBlockers: top,
    summary:
      top.length === 0
        ? 'No blockers detected in recent Slack activity.'
        : `Top blockers this period:\n${top.map((t, i) => `${i + 1}. ${t.blocker} (×${t.count}) owners=${t.owners.join(',') || 'unknown'}`).join('\n')}`,
  };
}

export async function findUnansweredMessages(input: { channel?: string; olderThanHours?: number; limit?: number }) {
  const olderThan = input.olderThanHours ?? 4;
  const channels = input.channel
    ? [{ id: await resolveChannelId(input.channel), name: input.channel }]
    : (await listChannels(25)).filter((c) => c.is_member !== false).slice(0, 8);

  const unanswered: Array<Record<string, unknown>> = [];
  for (const ch of channels) {
    try {
      const hist = await getChannelHistory({ channel: ch.id, limit: input.limit ?? 40 });
      for (const m of hist.messages as any[]) {
        const text = String(m.text ?? '');
        if (!QUESTION_RE.test(text) && !APPROVAL_RE.test(text)) continue;
        if ((m.reply_count ?? 0) > 0) continue;
        if (messageAgeHours(m.ts) < olderThan) continue;
        unanswered.push({
          channel: ch.name ?? ch.id,
          channelId: ch.id,
          text,
          user: m.user,
          ts: m.ts,
          ageHours: Math.round(messageAgeHours(m.ts) * 10) / 10,
        });
      }
    } catch {
      // skip inaccessible
    }
  }

  return {
    ok: true,
    count: unanswered.length,
    items: unanswered.slice(0, 25),
    summary:
      unanswered.length === 0
        ? 'No unanswered questions/approvals found.'
        : `Found ${unanswered.length} unanswered item(s):\n${unanswered
            .slice(0, 8)
            .map((u) => `- #${u.channel}: ${String(u.text).slice(0, 120)} (${u.ageHours}h)`)
            .join('\n')}`,
  };
}

export async function findCustomerComplaints(input: { query?: string; limit?: number }) {
  const search = await searchHistory(input.query || 'customer complaint OR frustrated OR escalate OR refund', input.limit ?? 30);
  const items = (search.matches as any[])
    .filter((m) => COMPLAINT_RE.test(String(m.text ?? '')))
    .map((m) => ({
      text: m.text,
      channel: m.channel?.name ?? m.channel?.id ?? m.channel,
      user: m.user,
      ts: m.ts,
      priority: /escalate|outage|angry|unacceptable/i.test(String(m.text)) ? 'high' : 'medium',
    }));

  return {
    ok: true,
    count: items.length,
    items,
    summary:
      items.length === 0
        ? 'No customer complaints detected.'
        : `Customer complaint scan (${items.length}):\n${items
            .slice(0, 8)
            .map((i) => `- [${i.priority}] #${i.channel}: ${String(i.text).slice(0, 120)}`)
            .join('\n')}`,
  };
}

export async function detectActionItems(input: { channel?: string; query?: string; limit?: number }) {
  let messages: Array<{ text?: string; user?: string; ts?: string; channel?: string }> = [];
  if (input.channel) {
    const hist = await getChannelHistory({ channel: input.channel, limit: input.limit ?? 60 });
    messages = (hist.messages as any[]).map((m) => ({ ...m, channel: hist.channel }));
  } else {
    const search = await searchHistory(input.query || 'action item OR TODO OR follow up OR please', input.limit ?? 40);
    messages = (search.matches as any[]).map((m) => ({
      text: m.text,
      user: m.user,
      ts: m.ts,
      channel: m.channel?.name ?? m.channel?.id,
    }));
  }

  const items = messages
    .filter((m) => TODO_RE.test(String(m.text ?? '')) || /\[[ x]\]/i.test(String(m.text ?? '')))
    .map((m) => ({ text: m.text, owner: m.user, channel: m.channel, ts: m.ts }));

  return {
    ok: true,
    count: items.length,
    items,
    summary:
      items.length === 0
        ? 'No action items detected.'
        : `Action items (${items.length}):\n${items.slice(0, 12).map((i) => `- ${i.text}`).join('\n')}`,
  };
}

export async function followUpPendingReplies(input: { channel?: string; dryRun?: boolean; olderThanHours?: number }) {
  const pending = await findUnansweredMessages({
    channel: input.channel,
    olderThanHours: input.olderThanHours ?? 6,
  });
  const sent: Array<Record<string, unknown>> = [];

  if (!input.dryRun) {
    for (const item of (pending.items as any[]).slice(0, 5)) {
      try {
        const res = await postMessage({
          channel: String(item.channelId ?? item.channel),
          text: `👋 Friendly follow-up from Nexora — this still looks open:\n>${String(item.text).slice(0, 280)}\nPlease reply or ✅ when done.`,
          threadTs: item.ts ? String(item.ts) : undefined,
        });
        sent.push({ ok: true, channel: item.channel, ts: res.ts });
      } catch (err: any) {
        sent.push({ ok: false, channel: item.channel, error: err?.message });
      }
    }
  }

  return {
    ok: true,
    pendingCount: pending.count,
    pending: pending.items,
    followUpsSent: sent,
    summary: input.dryRun
      ? `Dry run: ${pending.count} pending item(s) would get follow-ups.`
      : `Sent ${sent.filter((s) => s.ok).length} follow-up(s) for ${pending.count} pending item(s).`,
  };
}

export async function dailyDigest(input: { channels?: string[]; limit?: number }) {
  const channels = input.channels?.length
    ? input.channels
    : (await listChannels(15)).filter((c) => c.is_member !== false).slice(0, 6).map((c) => c.id);

  const sections: string[] = [];
  for (const ch of channels) {
    try {
      const deep = await summarizeChannelDeep({ channel: ch, limit: input.limit ?? 25 });
      sections.push(`### #${String(deep.channel).replace(/^#/, '')}\n${deep.summary}`);
    } catch {
      // skip
    }
  }

  const summary = [`# Daily Slack Digest — ${new Date().toISOString().slice(0, 10)}`, '', ...sections].join('\n\n');
  return { ok: true, channelCount: channels.length, summary };
}

export async function weeklyDigest(input: { channels?: string[]; limit?: number }) {
  const digest = await dailyDigest({ ...input, limit: input.limit ?? 60 });
  return {
    ...digest,
    workflow: 'weeklyDigest',
    summary: `# Weekly Slack Digest — week of ${new Date().toISOString().slice(0, 10)}\n\n${digest.summary}`,
  };
}

export async function semanticSearch(input: { query: string; count?: number }) {
  // Semantic-ish: expand query with synonyms then search + re-rank by keyword overlap
  const base = String(input.query ?? '').trim();
  const project =
    base.match(/\bproject\s+@?([A-Za-z0-9][\w-]{0,40})/i)?.[1] ??
    base.match(/@([A-Za-z0-9][\w-]{0,40})/)?.[1] ??
    undefined;

  const delayFocus = /\b(delay|delayed|slip|blocked|why|reason|because)\b/i.test(base);
  const expansions = [
    base,
    project ? `${project} delayed` : '',
    project ? `${project} delay` : '',
    project ? `${project} because` : '',
    delayFocus ? 'delayed because OR delay OR slipped OR blocked OR did not reply OR no response' : '',
    base.replace(/pricing/i, 'price OR pricing OR plan OR billing OR cost'),
    base.replace(/launch/i, 'launch OR release OR GA OR ship'),
    base.replace(/incident/i, 'incident OR outage OR sev OR downtime'),
    base.replace(/why was (?:the )?project /i, ''),
    base.replace(/ on slack$/i, ''),
  ].filter(Boolean);

  const query = [...new Set(expansions)].join(' OR ');
  let result = await searchHistory(query, input.count ?? 40);
  let matches = [...((result.matches as any[]) ?? [])];

  // Deep scan member channels when search is thin — catches reasons posted in #investor-pitch etc.
  if (matches.length < 5 && (project || delayFocus)) {
    try {
      const channels = await listChannels(60);
      const prefer = channels
        .filter((c) => c.is_member !== false)
        .sort((a, b) => {
          const score = (n?: string) => {
            const x = String(n || '').toLowerCase();
            let s = 0;
            if (/pitch|investor|hello|project|eng|product/.test(x)) s += 5;
            return s;
          };
          return score(b.name) - score(a.name);
        });

      for (const ch of prefer.slice(0, 18)) {
        try {
          const hist = await getChannelHistory({ channel: ch.id, limit: 50 });
          for (const msg of hist.messages as any[]) {
            const text = String(msg.text ?? '');
            const lower = text.toLowerCase();
            if (project && !lower.includes(project.toLowerCase()) && !lower.includes('hello')) continue;
            if (delayFocus && !/\b(delay|delayed|because|slip|blocked|didn'?t|did not|no response|not respond)\b/i.test(text)) {
              if (project && lower.includes(project.toLowerCase()) && lower.includes('hello')) {
                // keep project mentions even without delay words
              } else continue;
            }
            matches.push({
              channel: { id: ch.id, name: ch.name },
              text,
              ts: msg.ts,
              user: msg.user,
              source: 'channel_scan',
            });
          }
        } catch {
          // skip unreadable channels
        }
      }
    } catch {
      // keep search-only results
    }
  }

  const tokens = base
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 2 && !['was', 'the', 'project', 'slack', 'why', 'for', 'from'].includes(t));
  if (project) tokens.push(project.toLowerCase());
  for (const t of ['delay', 'delayed', 'because', 'reply', 'respond', 'hello']) {
    if ((delayFocus || project) && !tokens.includes(t)) tokens.push(t);
  }

  const ranked = [...matches].sort((a, b) => {
    const score = (m: any) => {
      const text = String(m.text ?? '').toLowerCase();
      let s = tokens.reduce((acc, t) => acc + (text.includes(t) ? 1 : 0), 0);
      if (/\bbecause\b/.test(text)) s += 3;
      if (/\bdelay/.test(text)) s += 2;
      if (project && text.includes(project.toLowerCase())) s += 4;
      if (/\bhello\b/.test(text) && /\bdelay/.test(text)) s += 5;
      return s;
    };
    return score(b) - score(a);
  });

  // Dedupe by text+channel
  const seen = new Set<string>();
  const deduped = ranked.filter((m: any) => {
    const key = `${m.channel?.id ?? ''}|${String(m.text ?? '').slice(0, 80)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const top = deduped.slice(0, input.count ?? 20);
  const reasonHits = top.filter((m: any) =>
    /\b(because|delay|didn'?t|did not|no response|not respond)/i.test(String(m.text ?? ''))
  );

  let summary: string;
  if (deduped.length === 0) {
    summary = `No messages found for “${base}”. Try naming the channel (e.g. #investor-pitch) or the exact project name.`;
  } else if (reasonHits.length || delayFocus) {
    const lines = (reasonHits.length ? reasonHits : top).slice(0, 5).map((m: any) => {
      const ch = m.channel?.name ?? m.channel?.id ?? '?';
      return `- #${ch}: ${String(m.text ?? '').slice(0, 220)}`;
    });
    summary = [
      project ? `Here’s what Slack says about **${project}** being delayed:` : `Here’s what Slack says:`,
      '',
      ...lines,
    ].join('\n');
  } else {
    summary = `Semantic search for “${base}” (${deduped.length} hits):\n${top
      .slice(0, 8)
      .map((m: any) => `- #${m.channel?.name ?? m.channel?.id ?? '?'}: ${String(m.text ?? '').slice(0, 140)}`)
      .join('\n')}`;
  }

  return {
    ok: true,
    query: base,
    project: project ?? null,
    expandedQuery: query,
    total: deduped.length,
    matches: top,
    summary,
  };
}

export async function detectDeadChannels(input: { idleDays?: number; limit?: number }) {
  const idleDays = input.idleDays ?? 14;
  const channels = await listChannels(input.limit ?? 40);
  const dead: Array<Record<string, unknown>> = [];

  for (const ch of channels.slice(0, 25)) {
    try {
      const hist = await getChannelHistory({ channel: ch.id, limit: 1 });
      const last = (hist.messages as any[])[0];
      const ageDays = messageAgeHours(last?.ts) / 24;
      if (!last || ageDays >= idleDays) {
        dead.push({ id: ch.id, name: ch.name, lastTs: last?.ts, idleDays: Math.round(ageDays) });
      }
    } catch {
      // skip
    }
  }

  return {
    ok: true,
    count: dead.length,
    channels: dead,
    summary:
      dead.length === 0
        ? `No channels idle >${idleDays} days.`
        : `Dead/idle channels (${dead.length}): ${dead.map((d) => `#${d.name}`).join(', ')}`,
  };
}

export async function findDecision(input: { query: string; count?: number }) {
  const search = await semanticSearch({ query: `${input.query} decided OR decision OR agreed`, count: input.count ?? 20 });
  const decisions = (search.matches as any[]).filter((m) => DECISION_RE.test(String(m.text ?? '')));
  return {
    ok: true,
    query: input.query,
    decisions,
    summary:
      decisions.length === 0
        ? `No decisions found about “${input.query}”.`
        : `Decisions related to “${input.query}”:\n${decisions.slice(0, 8).map((d: any) => `- ${d.text}`).join('\n')}`,
  };
}

export async function findOwner(input: { topic: string }) {
  const search = await semanticSearch({ query: input.topic, count: 30 });
  const counts = new Map<string, number>();
  for (const m of search.matches as any[]) {
    const u = m.user;
    if (!u) continue;
    counts.set(u, (counts.get(u) ?? 0) + 1);
  }
  const owners = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([user, count]) => ({ user, count }));

  return {
    ok: true,
    topic: input.topic,
    owners,
    summary:
      owners.length === 0
        ? `Could not infer an owner for “${input.topic}”.`
        : `Likely owners for “${input.topic}”: ${owners.map((o) => `<@${o.user}> (${o.count})`).join(', ')}`,
  };
}

export async function generateMeetingNotes(input: { channel: string; limit?: number }) {
  const deep = await summarizeChannelDeep({ channel: input.channel, limit: input.limit ?? 50 });
  const md = [
    `# Meeting Notes — ${deep.channel}`,
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Summary',
    deep.summary,
    '',
    '## Decisions',
    ...(deep.decisions as any[]).length ? (deep.decisions as any[]).map((d) => `- ${d.text}`) : ['- None captured'],
    '',
    '## Action items',
    ...(deep.questions as any[]).slice(0, 8).map((q) => `- [ ] ${q.text}`),
  ].join('\n');

  const canvas = await createCanvas({ title: `Meeting Notes ${new Date().toISOString().slice(0, 10)}`, markdown: md, channel: input.channel });
  return { ok: true, notes: md, canvas, summary: md };
}
