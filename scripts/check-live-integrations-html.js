const https = require('https');

function get(u) {
  return new Promise((res, rej) => {
    https
      .get(u, { headers: { 'user-agent': 'Mozilla/5.0', 'cache-control': 'no-cache' } }, (r) => {
        let d = '';
        r.on('data', (c) => (d += c));
        r.on('end', () => res({ status: r.statusCode, headers: r.headers, body: d }));
      })
      .on('error', rej);
  });
}

(async () => {
  const urls = [
    'https://try-nexora.netlify.app/app/integrations',
    'https://6a78faf7b2499cd8fae8bf54--try-nexora.netlify.app/app/integrations',
    'https://try-nexora.netlify.app/',
  ];
  for (const u of urls) {
    const r = await get(u);
    console.log('\nURL', u);
    console.log('status', r.status, 'len', r.body.length);
    console.log('has Connect Jira', r.body.includes('Connect Jira'));
    console.log('has oauth/jira', r.body.includes('oauth/jira'));
    console.log('has Not connected', r.body.includes('Not connected'));
    console.log('has Jira — connect', r.body.includes('Jira — connect') || r.body.includes('Jira - connect'));
    console.log('title', (r.body.match(/<title>[^<]+/) || [])[0]);
    console.log('snippet', r.body.slice(0, 500).replace(/\s+/g, ' '));
    const chunks = (r.body.match(/_next\/static\/chunks\/[^"']+/g) || []).slice(0, 10);
    console.log('chunks', chunks);
    const pageChunk = chunks.find((c) => c.includes('integrations/page-'));
    if (pageChunk) {
      const js = await get('https://try-nexora.netlify.app/' + pageChunk.replace(/^\//, ''));
      console.log('page js', pageChunk, 'len', js.body.length);
      console.log('js Connect Jira', js.body.includes('Connect Jira'));
      console.log('js oauth/jira', js.body.includes('oauth/jira'));
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
