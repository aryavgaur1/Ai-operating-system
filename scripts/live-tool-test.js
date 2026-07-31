/* eslint-disable no-console */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { WebClient } = require('@slack/web-api');
const { Client } = require('@notionhq/client');

const stamp = Date.now().toString().slice(-6);
const results = [];

function log(step, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${step} | ${detail}`);
  results.push({ step, ok, detail });
}

async function waitApi() {
  for (let i = 0; i < 40; i++) {
    try {
      const h = await fetch('http://localhost:4000/health');
      if (h.ok) return h.json();
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('API not up on :4000 — run npm run dev:api with SAAS_MODE=false');
}

async function login() {
  const r = await fetch('http://localhost:4000/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: process.env.ADMIN_SEED_EMAIL || 'aryavgaur1@gmail.com',
      password: process.env.ADMIN_SEED_PASSWORD || 'keshuyashi',
      rememberMe: true,
    }),
  });
  const j = await r.json();
  const token = j.data?.accessToken || j.data?.token;
  if (!token) throw new Error(`login failed: ${j.message || r.status}`);
  return token;
}

async function chat(token, message) {
  const r = await fetch('http://localhost:4000/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message }),
  });
  const j = await r.json();
  return {
    status: r.status,
    reply: j.reply || j.data?.reply,
    exec: (j.executedCalls || j.data?.executedCalls || [])[0] || null,
    plan: (j.plan || j.data?.plan)?.toolCalls?.[0] || null,
  };
}

(async () => {
  console.log('===== NEXORA LIVE TOOL TEST =====');
  const health = await waitApi();
  log('health', health.ok === true, JSON.stringify(health));
  if (health.saas !== false) {
    console.log('WARN: SAAS_MODE is true — demo expects false');
  }

  const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
  const notion = new Client({ auth: process.env.NOTION_API_KEY });
  const auth = await slack.auth.test();
  log('slack.auth.test', !!auth.ok, `team=${auth.team} url=${auth.url}`);

  const nSearch = await notion.search({ page_size: 1 });
  log('notion.search', Array.isArray(nSearch.results), `results=${nSearch.results.length}`);

  const token = await login();
  log('auth.login', !!token, 'token issued');

  const chName = `inv-demo-${stamp}`;
  const cmds = [
    { label: 'S1 createChannel', msg: `create new channel ${chName}`, expect: 'createChannel' },
    { label: 'S2 listChannels', msg: 'list channels on slack', expect: 'listChannels' },
    {
      label: 'S3 postMessage',
      msg: `post "Investor demo ping ${stamp}" to #${chName} on slack`,
      expect: 'postMessage',
    },
    { label: 'S4 getHistory', msg: `show history for #${chName} on slack`, expect: 'getChannelHistory' },
    { label: 'S5 summarize', msg: `summarize channel #${chName} on slack`, expect: 'summarizeChannel' },
    { label: 'S6 listUsers', msg: 'list users on slack', expect: 'listUsers' },
  ];

  let createdId = null;
  for (const c of cmds) {
    const out = await chat(token, c.msg);
    const action = out.exec?.action || out.plan?.action;
    const ok =
      out.status < 400 && out.exec?.ok === true && out.exec?.mocked !== true && action === c.expect;
    log(
      c.label,
      ok,
      `action=${action} mocked=${out.exec?.mocked} err=${out.exec?.error || ''} out=${JSON.stringify(out.exec?.output || {}).slice(0, 180)}`
    );
    if (c.expect === 'createChannel' && out.exec?.output?.id) createdId = out.exec.output.id;
    await new Promise((r) => setTimeout(r, 700));
  }

  const pageTitle = `Investor Notes ${stamp}`;
  const nOut = await chat(token, `create a notion page titled "${pageTitle}"`);
  const nAction = nOut.exec?.action || nOut.plan?.action;
  const nOk =
    nOut.status < 400 && nOut.exec?.ok === true && nOut.exec?.mocked !== true && nAction === 'createPage';
  log(
    'N1 createPage',
    nOk,
    `action=${nAction} mocked=${nOut.exec?.mocked} err=${nOut.exec?.error || ''} out=${JSON.stringify(nOut.exec?.output || {}).slice(0, 220)}`
  );
  const pageId = nOut.exec?.output?.id || null;

  // Second notion command if first worked — search-style via another page create is enough;
  // also try a second create with different title
  const pageTitle2 = `Demo Page ${stamp}`;
  const nOut2 = await chat(token, `create a notion page called ${pageTitle2}`);
  const nAction2 = nOut2.exec?.action || nOut2.plan?.action;
  log(
    'N2 createPage2',
    nOut2.exec?.ok === true && nOut2.exec?.mocked !== true && nAction2 === 'createPage',
    `action=${nAction2} err=${nOut2.exec?.error || ''} id=${nOut2.exec?.output?.id || ''}`
  );

  for (let i = 1; i <= 3; i++) {
    if (!createdId) {
      log(`VERIFY_SLACK_${i}`, false, 'no channel id from chat create');
      continue;
    }
    const info = await slack.conversations.info({ channel: createdId });
    const hist = await slack.conversations.history({ channel: createdId, limit: 5 });
    const ok = !!info.ok && info.channel?.name === chName && (hist.messages || []).length >= 1;
    log(
      `VERIFY_SLACK_${i}`,
      ok,
      `name=${info.channel?.name} id=${info.channel?.id} msgs=${(hist.messages || []).length}`
    );
    await new Promise((r) => setTimeout(r, 400));
  }

  for (let i = 1; i <= 3; i++) {
    if (!pageId) {
      log(`VERIFY_NOTION_${i}`, false, 'no page id from chat create');
      continue;
    }
    const page = await notion.pages.retrieve({ page_id: pageId });
    const ok = !!page.id && page.object === 'page' && page.archived !== true;
    log(`VERIFY_NOTION_${i}`, ok, `id=${page.id} url=${page.url || ''} archived=${page.archived}`);
    await new Promise((r) => setTimeout(r, 300));
  }

  const failed = results.filter((r) => !r.ok);
  console.log('===== SUMMARY =====');
  console.log(`TOTAL ${results.length} PASS ${results.length - failed.length} FAIL ${failed.length}`);
  console.log(`WORKSPACE ${auth.team} ${auth.url}`);
  console.log(`CHANNEL #${chName} ${createdId}`);
  console.log(`NOTION_PAGE ${pageTitle} ${pageId}`);
  if (failed.length) {
    console.log('FAILURES:');
    failed.forEach((f) => console.log(' -', f.step, f.detail));
    process.exit(1);
  }
  console.log('ALL TESTS PASSED');
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
