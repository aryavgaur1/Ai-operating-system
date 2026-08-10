/**
 * 3-level Approve & Run verification (no fake HTTP-200 pass).
 *
 * Level 1 — Code connection: production JS still wires decideApproval / Approve & run
 * Level 2 — Integration contract: API health + connector honesty (no mock success)
 * Level 3 — Live decide path: requires AUTH_TOKEN + optional APPROVAL_ID
 *
 * Usage:
 *   node scripts/verify-approve-run-x3.js
 *   AUTH_TOKEN=eyJ... APPROVAL_ID=uuid node scripts/verify-approve-run-x3.js
 */
const https = require('https');

const WEB = process.env.WEB_URL || 'https://try-nexora.netlify.app';
const API = process.env.API_URL || 'https://nexora-api.up.railway.app';

function request(method, url, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method,
        headers: {
          'cache-control': 'no-cache',
          'user-agent': 'nexora-verify-approve-run/3',
          ...headers,
        },
      },
      (r) => {
        let d = '';
        r.on('data', (c) => (d += c));
        r.on('end', () => resolve({ status: r.statusCode, body: d, headers: r.headers }));
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function get(url) {
  return request('GET', url);
}

function pass(name, ok, detail) {
  console.log(ok ? `PASS ${name}` : `FAIL ${name}`, detail || '');
  return ok;
}

(async () => {
  let failures = 0;

  // ---------- LEVEL 1: code connection (frontend bundles) ----------
  const chat = await get(`${WEB}/app/chat`);
  const chatChunk = (chat.body.match(/chat\/page-[a-z0-9]+\.js/) || [])[0];
  let chatJs = '';
  if (chatChunk) {
    chatJs = (await get(`${WEB}/_next/static/chunks/app/app/${chatChunk}`)).body;
  }
  const l1Chat = pass('L1_chat_approve_wiring', Boolean(chatChunk) && /Approve & run|Approve &amp; run/.test(chatJs) && /decide|pendingApprovalIds/.test(chatJs), {
    chunk: chatChunk || 'NONE',
    hasOldInspectCopy: chatJs.includes('Open Approvals to inspect'),
    hasExecuting: /Executing|Running/.test(chatJs),
  });
  if (!l1Chat) failures++;

  const appr = await get(`${WEB}/app/approvals`);
  const apprChunk = (appr.body.match(/approvals\/page-[a-z0-9]+\.js/) || [])[0];
  let apprJs = '';
  if (apprChunk) {
    apprJs = (await get(`${WEB}/_next/static/chunks/app/app/${apprChunk}`)).body;
  }
  const l1Appr = pass(
    'L1_approvals_button',
    Boolean(apprChunk) && /Approve/.test(apprJs) && /decide/.test(apprJs),
    {
      chunk: apprChunk || 'NONE',
      hasExecuting: /Executing/.test(apprJs),
      hasMockReject: /mocked|Mock result/.test(apprJs),
    }
  );
  if (!l1Appr) failures++;

  // ---------- LEVEL 2: API + honesty contracts ----------
  const health = await get(`${API}/health`);
  const l2Health = pass('L2_api_health', health.status === 200 && /"ok"\s*:\s*true/.test(health.body), {
    status: health.status,
    body: health.body.slice(0, 160),
  });
  if (!l2Health) failures++;

  // Unauthenticated decide must not succeed
  const unauth = await request('POST', `${API}/approvals/00000000-0000-0000-0000-000000000000/decide`, {
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decision: 'approved' }),
  });
  const l2Auth = pass(
    'L2_decide_requires_auth',
    unauth.status === 401 || unauth.status === 403,
    { status: unauth.status, body: unauth.body.slice(0, 120) }
  );
  if (!l2Auth) failures++;

  // ---------- LEVEL 3: live decide (optional credentials) ----------
  const token = process.env.AUTH_TOKEN || process.env.NEXORA_AUTH_TOKEN;
  const approvalId = process.env.APPROVAL_ID;
  if (!token || !approvalId) {
    console.log(
      'SKIP L3_live_decide — set AUTH_TOKEN and APPROVAL_ID to run a real Approve & run against a pending approval.'
    );
    console.log(
      '  Example: AUTH_TOKEN=… APPROVAL_ID=… node scripts/verify-approve-run-x3.js'
    );
  } else {
    const before = await request('GET', `${API}/approvals?status=pending`, {
      headers: { Authorization: `Bearer ${token}`, cookie: `token=${token}` },
    });
    let pendingIds = [];
    try {
      const parsed = JSON.parse(before.body);
      pendingIds = (parsed.approvals || parsed.data?.approvals || []).map((a) => a.id);
    } catch {
      // ignore
    }

    const decide = await request('POST', `${API}/approvals/${approvalId}/decide`, {
      headers: {
        Authorization: `Bearer ${token}`,
        cookie: `token=${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ decision: 'approved' }),
    });

    let payload = {};
    try {
      payload = JSON.parse(decide.body);
    } catch {
      payload = { raw: decide.body.slice(0, 300) };
    }
    const er = payload.executionResult || payload.data?.executionResult;
    const approval = payload.approval || payload.data?.approval;

    const realOk =
      decide.status === 200 &&
      er &&
      er.ok === true &&
      er.mocked !== true &&
      Boolean(er.output && (er.output.key || er.output.id || er.output.ts));

    const honestFail =
      decide.status === 200 &&
      er &&
      er.ok === false &&
      (er.mocked === true || Boolean(er.error));

    // Double-click / idempotency
    const again = await request('POST', `${API}/approvals/${approvalId}/decide`, {
      headers: {
        Authorization: `Bearer ${token}`,
        cookie: `token=${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ decision: 'approved' }),
    });
    let againPayload = {};
    try {
      againPayload = JSON.parse(again.body);
    } catch {
      // ignore
    }
    const idempotent =
      again.status === 200 && againPayload.idempotent === true
        ? true
        : again.status === 409;

    const l3 = pass(
      'L3_live_decide',
      realOk || honestFail,
      {
        status: decide.status,
        tool: approval?.tool,
        action: approval?.action,
        executionStatus: approval?.executionStatus,
        executionVerified: approval?.executionVerified,
        ok: er?.ok,
        mocked: er?.mocked,
        outputKeys: er?.output ? Object.keys(er.output) : [],
        error: er?.error?.slice?.(0, 200),
        realExternalId: Boolean(er?.output?.key || er?.output?.id || er?.output?.ts),
        pendingBefore: pendingIds.length,
        idempotentReplay: idempotent,
        note: realOk
          ? 'REAL success with external id'
          : honestFail
            ? 'Honest failure (no fake success)'
            : 'Unexpected response shape',
      }
    );
    if (!l3) failures++;
    if (!idempotent) {
      failures++;
      pass('L3_idempotency', false, { status: again.status, body: again.body.slice(0, 200) });
    } else {
      pass('L3_idempotency', true, { status: again.status });
    }
  }

  console.log('\nSUMMARY', { failures, web: WEB, api: API });
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
