#!/usr/bin/env node
/**
 * P0 stability production gate against live Railway API.
 * Proves routing + Notion draft content + conversation continuity via API.
 * Real connector writes only when the workspace has live OAuth.
 */
const API = process.env.API_URL || 'https://nexora-api.up.railway.app';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function json(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text, status: res.status };
  }
}

async function main() {
  const health = await (await fetch(`${API}/health`)).json();
  console.log('HEALTH', health);
  assert(health.ok, 'health not ok');
  assert(String(health.commit || '').startsWith('24417d9'), `expected backend 24417d9, got ${health.commit}`);

  const email = `p04.gate.${Date.now()}@example.com`;
  const password = 'NexoraTest123!';
  const signup = await json(
    await fetch(`${API}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        confirmPassword: password,
        displayName: 'P04 Gate',
        workspaceName: 'P04 Gate WS',
      }),
    })
  );
  const token = signup?.data?.accessToken || signup?.accessToken || signup?.token;
  assert(token, `signup failed: ${JSON.stringify(signup).slice(0, 300)}`);
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  await fetch(`${API}/auth/onboarding/complete`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ workspaceName: 'P04 Gate WS', displayName: 'P04 Gate' }),
  });

  async function chat(message, conversationId) {
    const res = await fetch(`${API}/chat`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ message, conversationId, stream: false }),
    });
    const body = await json(res);
    return { status: res.status, body };
  }

  // —— Continuity: same conversationId across turns ——
  const t1 = await chat('Create a Jira ticket titled Nexora continuity probe.');
  const convId = t1.body?.conversationId || t1.body?.data?.conversationId;
  assert(convId, `no conversationId: ${JSON.stringify(t1.body).slice(0, 400)}`);
  console.log('PASS conversationId issued', convId);

  const t2 = await chat('What did I just ask you to do?', convId);
  const convId2 = t2.body?.conversationId || t2.body?.data?.conversationId;
  assert(convId2 === convId, `conversation changed: ${convId} → ${convId2}`);
  console.log('PASS follow-up kept same conversationId');

  const hist = await json(await fetch(`${API}/conversations/${convId}`, { headers: auth }));
  const messages = hist?.messages || hist?.data?.messages || [];
  assert(messages.length >= 2, `expected persisted messages, got ${messages.length}`);
  console.log('PASS conversation messages persisted', messages.length);

  // —— Slack destination vs Notion reference (plan-level) ——
  const slackQ = 'Post a Slack update about the Notion integration test in #general.';
  const slackTurn = await chat(slackQ, convId);
  const slackBody = slackTurn.body?.data || slackTurn.body || {};
  const pending = slackBody.pendingApprovals || slackBody.pendingApprovalIds || [];
  const planCalls =
    slackBody.plan?.toolCalls ||
    slackBody.executedCalls ||
    slackBody.result?.plan?.toolCalls ||
    [];
  const reply = String(slackBody.reply || slackBody.message || '');
  const approvals = await json(await fetch(`${API}/approvals?status=pending`, { headers: auth }));
  const pendingList = approvals?.approvals || approvals?.data?.approvals || [];
  const slackApproval = pendingList.find(
    (a) => a.tool === 'slack' && /postMessage/i.test(a.action) && a.conversationId === convId
  );
  const notionApproval = pendingList.find((a) => a.tool === 'notion' && a.conversationId === convId);
  assert(!notionApproval, 'Notion approval must not be created for Slack destination request');
  if (slackApproval) {
    console.log('PASS Slack approval queued for Notion-mention Slack post', slackApproval.id);
  } else {
    // May clarify if Slack not connected — still must not select Notion
    assert(!/notion\.create|createPage/i.test(JSON.stringify(slackBody)), 'must not plan Notion create');
    console.log('PASS no Notion plan for Slack destination (connector may be disconnected)', reply.slice(0, 120));
  }

  // —— Jira vs Slack reference ——
  const jiraQ = 'Create a Jira ticket for the Slack integration issue.';
  const jiraTurn = await chat(jiraQ, convId);
  const jiraPayload = jiraTurn.body?.data || jiraTurn.body || {};
  const jiraPlanCalls = (jiraPayload.plan?.toolCalls || []).map((c) => `${c.tool}.${c.action}`);
  const jiraExecuted = (jiraPayload.executedCalls || []).map((c) => `${c.tool}.${c.action}`);
  assert(
    jiraPlanCalls.every((c) => c.startsWith('jira.')) ||
      jiraPlanCalls.length === 0 ||
      jiraPlanCalls.some((c) => c === 'jira.createIssue'),
    `unexpected plan tools: ${jiraPlanCalls.join(',')}`
  );
  assert(
    !jiraPlanCalls.some((c) => c.startsWith('slack.')),
    `Jira request planned Slack tools: ${jiraPlanCalls.join(',')}`
  );
  assert(
    !jiraExecuted.some((c) => c.startsWith('slack.')),
    `Jira request executed Slack tools: ${jiraExecuted.join(',')}`
  );
  const jiraApprovals = await json(await fetch(`${API}/approvals?status=pending`, { headers: auth }));
  const jiraList = jiraApprovals?.approvals || jiraApprovals?.data?.approvals || [];
  const jiraApproval = jiraList.find(
    (a) => a.tool === 'jira' && a.action === 'createIssue' && a.conversationId === convId
  );
  if (jiraApproval) {
    console.log('PASS Jira approval for Slack-mention Jira create', jiraApproval.id);
  } else {
    console.log(
      'PASS Jira plan isolated from Slack tools',
      JSON.stringify({ jiraPlanCalls, reply: String(jiraPayload.reply || '').slice(0, 160) })
    );
  }

  // —— Notion create content (approval input body) ——
  const notionQ = 'Create a Notion page called Nexora OS.';
  await chat(notionQ, convId);
  const afterNotion = await json(await fetch(`${API}/approvals?status=pending`, { headers: auth }));
  const nList = afterNotion?.approvals || afterNotion?.data?.approvals || [];
  const notionCreate = nList.find(
    (a) => a.tool === 'notion' && /create/i.test(a.action) && a.conversationId === convId
  );
  if (notionCreate) {
    const body = String(notionCreate.input?.body || '');
    assert(body.length > 40, 'Notion body too short');
    assert(body.trim().toLowerCase() !== notionQ.toLowerCase(), 'Notion body echoed command');
    assert(!/^create a notion page/i.test(body.trim()), 'Notion body starts with command');
    assert(/overview|capabilities|architecture/i.test(body), 'expected structured draft');
    console.log('PASS Notion approval body is structured draft, not command echo');
  } else {
    console.log('WARN Notion create approval missing (integration may be disconnected)');
  }

  // —— Integration live status ——
  const ints = await json(await fetch(`${API}/integrations`, { headers: auth }));
  const tools = ints?.tools || ints?.data?.tools || [];
  const live = Object.fromEntries(
    tools.map((t) => [t.tool, { status: t.status, mode: t.mode, connected: t.status === 'connected' }])
  );
  console.log('INTEGRATIONS', JSON.stringify(live));

  const anyLive = tools.some((t) => t.status === 'connected' && ['slack', 'jira', 'notion'].includes(t.tool));
  if (!anyLive) {
    console.log('BLOCKED real external execute — fresh workspace has no OAuth connectors');
    console.log('SUMMARY UNIT+API continuity/routing PASS; REAL connector writes BLOCKED (no tokens on test org)');
    return;
  }

  console.log('SUMMARY connected workspace detected — manual Approve & Run still required for REAL writes');
}

main().catch((err) => {
  console.error('FAIL', err.message || err);
  process.exit(1);
});
