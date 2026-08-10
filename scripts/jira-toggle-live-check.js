const API = 'https://try-nexora.netlify.app';

(async () => {
  const html = await (await fetch(API + '/app/integrations')).text();
  console.log('has_Connect_Jira_html', /Connect Jira/.test(html));
  console.log('has_oauth_jira_html', /oauth\/jira/.test(html));
  const scripts = [...html.matchAll(/\/_next\/static\/[^"']+\.js/g)].map((m) => m[0]);
  console.log('script_count', scripts.length);
  let found = false;
  for (const s of scripts.slice(0, 80)) {
    const js = await (await fetch(API + s)).text();
    if (/Connect Jira|oauth\/jira/.test(js)) {
      console.log('FOUND', s);
      found = true;
      break;
    }
  }
  if (!found) console.log('NOT_IN_SCRIPTS');

  // Also check page JS for old DEFAULT jira:true pattern remnants in integrations chunk names
  const pageChunks = scripts.filter((s) => /integrations|app\/app/.test(s));
  console.log('page_like_chunks', pageChunks.slice(0, 10));

  const health = await (await fetch('https://nexora-api.up.railway.app/health')).json();
  console.log('api', health);

  // signup + integrations meta to prove API canConnect/connectUrl for jira
  const email = `jira.toggle.check.${Date.now()}@example.com`;
  const password = 'NexoraTest123!';
  const signup = await fetch('https://nexora-api.up.railway.app/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      confirmPassword: password,
      displayName: 'Toggle Check',
      workspaceName: 'Toggle WS',
    }),
  }).then((r) => r.json());
  const token = signup?.data?.accessToken || signup?.accessToken || signup?.token;
  console.log('signup_token', Boolean(token));
  if (!token) {
    console.log('signup_body', signup);
    process.exit(2);
  }
  await fetch('https://nexora-api.up.railway.app/auth/onboarding/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ workspaceName: 'Toggle WS', displayName: 'Toggle Check' }),
  });
  const ints = await fetch('https://nexora-api.up.railway.app/integrations', {
    headers: { Authorization: 'Bearer ' + token },
  }).then((r) => r.json());
  const tools = ints?.data?.tools || ints?.tools || [];
  const jira = tools.find((t) => t.tool === 'jira');
  console.log('jira_meta', {
    status: jira?.status,
    mode: jira?.mode,
    canConnect: jira?.canConnect,
    hasConnectUrl: Boolean(jira?.connectUrl),
    connectUrlPrefix: String(jira?.connectUrl || '').slice(0, 80),
  });
  if (jira?.connectUrl) {
    const oauth = await fetch(jira.connectUrl, { redirect: 'manual' });
    const loc = oauth.headers.get('location') || '';
    console.log('oauth_start', { status: oauth.status, loc: loc.slice(0, 120) });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
