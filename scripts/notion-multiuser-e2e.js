const API = 'https://nexora-api.up.railway.app';

async function req(path, { method='GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

function data(j) { return j?.data ?? j; }

(async () => {
  const email = `notion.e2e.${Date.now()}@example.com`;
  const password = 'NexoraTest123!';
  console.log('CYCLE signup', email);
  const signup = await req('/auth/signup', { method:'POST', body: {
    email, password, confirmPassword: password, displayName: 'Notion E2E', workspaceName: 'Notion E2E WS'
  }});
  console.log('signup_status', signup.status, signup.json?.message || signup.json?.error || '');
  let token = data(signup.json)?.accessToken || data(signup.json)?.token;
  let refresh = data(signup.json)?.refreshToken;
  if (!token) {
    console.log('signup_body', JSON.stringify(signup.json).slice(0,400));
    process.exit(1);
  }

  // complete onboarding so chat works
  const onboard = await req('/auth/onboarding/complete', { method:'POST', token, body: {
    workspaceName: 'Notion E2E WS', displayName: 'Notion E2E'
  }});
  console.log('onboarding', onboard.status, onboard.json?.message || onboard.json?.error || 'ok');

  const ints1 = await req('/integrations', { token });
  const tools1 = data(ints1.json)?.tools || [];
  const notion1 = tools1.find(t => t.tool === 'notion');
  console.log('notion_before', { status: notion1?.status, mode: notion1?.mode, canConnect: notion1?.canConnect, hasConnectUrl: !!notion1?.connectUrl });

  // Probe OAuth start (should 302 to notion)
  const oauthRes = await fetch(notion1.connectUrl, { redirect: 'manual' });
  const loc = oauthRes.headers.get('location') || '';
  console.log('oauth_start', oauthRes.status, loc.slice(0,180));
  const redirectParam = decodeURIComponent((loc.match(/redirect_uri=([^&]+)/)||[])[1] || '');
  console.log('oauth_redirect_uri_param', redirectParam);

  // If we have platform NOTION_API_KEY locally, simulate per-user token paste (multi-user path #2)
  const fs = require('fs');
  const env = fs.readFileSync('.env','utf8');
  const notionKey = (env.match(/^NOTION_API_KEY=(.+)$/m)||[])[1]?.trim();
  if (notionKey) {
    const paste = await req('/integrations/notion/connect-token', { method:'POST', token, body: { accessToken: notionKey } });
    console.log('token_paste', paste.status, JSON.stringify(data(paste.json) || paste.json).slice(0,250));
  } else {
    console.log('token_paste_skipped_no_local_key');
  }

  const ints2 = await req('/integrations', { token });
  const notion2 = (data(ints2.json)?.tools || []).find(t => t.tool === 'notion');
  console.log('notion_after', { status: notion2?.status, mode: notion2?.mode, workspaceName: notion2?.workspaceName });

  const chat = await req('/chat', { method:'POST', token, body: { message: 'create a notion page titled Nexora Multiuser Probe ' + Date.now() } });
  console.log('chat_status', chat.status);
  const chatData = data(chat.json);
  console.log('chat_reply', String(chatData?.reply || chat.json?.message || chat.json?.error || '').slice(0,500));
  console.log('executed', JSON.stringify((chatData?.executedCalls||[]).map(c => ({ tool:c.tool, action:c.action, ok:c.ok, error:c.error, mocked:c.mocked, url:c.output?.url }))).slice(0,600));
})().catch(e => { console.error(e); process.exit(1); });
