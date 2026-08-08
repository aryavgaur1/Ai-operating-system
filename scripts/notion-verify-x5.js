const API = 'https://nexora-api.up.railway.app';
const fs = require('fs');
const env = fs.readFileSync('.env','utf8');
const notionKey = (env.match(/^NOTION_API_KEY=(.+)$/m)||[])[1]?.trim();

async function req(path, { method='GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}
const data = (j) => j?.data ?? j;

(async () => {
  let pass = 0;
  for (let i = 1; i <= 5; i++) {
    const email = `notion.e2e.${Date.now()}.${i}@example.com`;
    const password = 'NexoraTest123!';
    const signup = await req('/auth/signup', { method:'POST', body: {
      email, password, confirmPassword: password, displayName: 'Notion E2E '+i, workspaceName: 'WS '+i
    }});
    const token = data(signup.json)?.accessToken || data(signup.json)?.token;
    if (!token) { console.log('FAIL', i, 'signup', signup.status); continue; }
    await req('/auth/onboarding/complete', { method:'POST', token, body: { workspaceName: 'WS '+i, displayName: 'Notion E2E '+i }});

    const ints = await req('/integrations', { token });
    const notion = (data(ints.json)?.tools || []).find(t => t.tool === 'notion');
    if (!(notion?.canConnect && notion?.connectUrl && notion?.mode === 'live')) {
      console.log('FAIL', i, 'integrations meta', notion); continue;
    }
    const oauthRes = await fetch(notion.connectUrl, { redirect: 'manual' });
    const loc = oauthRes.headers.get('location') || '';
    const redirectParam = decodeURIComponent((loc.match(/redirect_uri=([^&]+)/)||[])[1] || '');
    if (oauthRes.status !== 302 || redirectParam !== 'https://nexora-api.up.railway.app/oauth/notion/callback') {
      console.log('FAIL', i, 'oauth start', oauthRes.status, redirectParam); continue;
    }

    const paste = await req('/integrations/notion/connect-token', { method:'POST', token, body: { accessToken: notionKey } });
    if (paste.status !== 200 || !data(paste.json)?.connected) {
      console.log('FAIL', i, 'paste', paste.status, paste.json); continue;
    }

    const chat = await req('/chat', { method:'POST', token, body: { message: 'create a notion page titled Nexora Verify Cycle '+i+' '+Date.now() } });
    const chatData = data(chat.json);
    const call = (chatData?.executedCalls || []).find(c => c.tool === 'notion' && c.action === 'createPage');
    const ok = chat.status === 200 && call?.ok === true && !call?.mocked && !!call?.output?.url;
    console.log(ok ? 'PASS' : 'FAIL', i, {
      chat: chat.status,
      ok: call?.ok,
      mocked: call?.mocked,
      url: call?.output?.url,
      reply: String(chatData?.reply||'').slice(0,120)
    });
    if (ok) pass++;
  }
  console.log('SUMMARY', pass + '/5 passed');
  process.exit(pass === 5 ? 0 : 2);
})().catch(e => { console.error(e); process.exit(1); });
