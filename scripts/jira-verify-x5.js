/**
 * Jira live verify x5 (SaaS):
 * 1) signup
 * 2) integrations meta (canConnect + live + connectUrl)
 * 3) OAuth start → Atlassian authorize with correct client_id + redirect_uri
 * 4) chat without connect → clear Connect Jira guidance (not mock success)
 * 5) if a prior connected token exists for this cycle via forced store — skip
 *
 * Full createIssue requires browser OAuth once; cycles validate the live path wiring.
 */
const API = process.env.API_URL || 'https://nexora-api.up.railway.app';
const EXPECTED_CLIENT = process.env.JIRA_CLIENT_ID || 'pSUHcX0p2m7gjtNCTSVM6SDZNDpbUbl8';
const EXPECTED_REDIRECT =
  process.env.JIRA_OAUTH_REDIRECT_URI || 'https://nexora-api.up.railway.app/oauth/jira/callback';

async function req(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(API + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}
const data = (j) => j?.data ?? j;

function check(name, cond, detail) {
  if (!cond) {
    const err = new Error(name + (detail ? ': ' + JSON.stringify(detail) : ''));
    err.detail = detail;
    throw err;
  }
}

(async () => {
  let pass = 0;
  for (let i = 1; i <= 5; i++) {
    const stamp = Date.now();
    const email = `jira.e2e.${stamp}.${i}@example.com`;
    const password = 'NexoraTest123!';
    try {
      const signup = await req('/auth/signup', {
        method: 'POST',
        body: {
          email,
          password,
          confirmPassword: password,
          displayName: 'Jira E2E ' + i,
          workspaceName: 'Jira WS ' + i,
        },
      });
      const token = data(signup.json)?.accessToken || data(signup.json)?.token;
      check('signup', Boolean(token), { status: signup.status, json: signup.json });

      await req('/auth/onboarding/complete', {
        method: 'POST',
        token,
        body: { workspaceName: 'Jira WS ' + i, displayName: 'Jira E2E ' + i },
      });

      const ints = await req('/integrations', { token });
      const jira = (data(ints.json)?.tools || []).find((t) => t.tool === 'jira');
      check('integrations_meta', Boolean(jira?.canConnect && jira?.connectUrl && jira?.mode === 'live'), jira);

      const oauthRes = await fetch(jira.connectUrl, { redirect: 'manual' });
      const loc = oauthRes.headers.get('location') || '';
      const clientId = decodeURIComponent((loc.match(/client_id=([^&]+)/) || [])[1] || '');
      const redirectParam = decodeURIComponent((loc.match(/redirect_uri=([^&]+)/) || [])[1] || '');
      const audience = decodeURIComponent((loc.match(/audience=([^&]+)/) || [])[1] || '');
      const scope = decodeURIComponent((loc.match(/scope=([^&]+)/) || [])[1] || '');
      check('oauth_status', oauthRes.status === 302, { status: oauthRes.status, loc: loc.slice(0, 120) });
      check('oauth_host', loc.startsWith('https://auth.atlassian.com/authorize'), loc.slice(0, 80));
      check('oauth_client', clientId === EXPECTED_CLIENT, { clientId });
      check('oauth_redirect', redirectParam === EXPECTED_REDIRECT, { redirectParam });
      check('oauth_audience', audience === 'api.atlassian.com', { audience });
      check(
        'oauth_scopes',
        /read:jira-work/.test(scope) && /write:jira-work/.test(scope) && /offline_access/.test(scope),
        { scope }
      );

      const chat = await req('/chat', {
        method: 'POST',
        token,
        body: { message: `create a jira ticket titled Verify Cycle ${i} ${stamp}` },
      });
      const chatData = data(chat.json);
      const call = (chatData?.executedCalls || []).find((c) => c.tool === 'jira');
      const reply = String(chatData?.reply || '');
      // Must NOT fake success. Should ask to Connect Jira (or fail live path cleanly).
      const noFakeSuccess = !(call?.ok === true && call?.mocked === true);
      const guidesConnect =
        /Connect Jira|not connected|Integrations/i.test(reply) ||
        /Connect Jira|not connected/i.test(String(call?.error || '')) ||
        (chat.status === 200 && call && call.ok === false);
      check('no_mock_success', noFakeSuccess, { call, reply: reply.slice(0, 160) });
      check('guides_or_hard_fail', guidesConnect || call?.ok === false, {
        reply: reply.slice(0, 160),
        call,
      });

      console.log('PASS', i, {
        email,
        oauth: 'atlassian_ok',
        mode: jira.mode,
        chatStatus: chat.status,
        callOk: call?.ok,
        mocked: call?.mocked,
      });
      pass++;
    } catch (e) {
      console.log('FAIL', i, e.message);
    }
  }
  console.log('SUMMARY', pass + '/5 passed');
  process.exit(pass === 5 ? 0 : 2);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
