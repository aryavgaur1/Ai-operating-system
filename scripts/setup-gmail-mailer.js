#!/usr/bin/env node
/**
 * One-time Gmail API OAuth2 setup for Nexora email delivery.
 *
 * Run: npm run setup:gmail-mailer
 *
 * This script:
 *  1. Reads GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET from .env
 *  2. Prints a Google authorization URL
 *  3. You visit the URL, authorize the Gmail account, get a code
 *  4. Paste the code here
 *  5. Script exchanges the code for tokens
 *  6. Prints ONLY the refresh token for you to set in Railway
 *
 * The refresh token is printed once and never stored in code or committed.
 */

'use strict';

require('dotenv').config();
const https = require('https');
const readline = require('readline');

const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();

if (!clientId || !clientSecret) {
  console.error('ERROR: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env');
  process.exit(1);
}

// Must match exactly what is set in Google Cloud Console → OAuth redirect URIs
const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob';
const SCOPE = 'https://www.googleapis.com/auth/gmail.send';

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', clientId);
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', SCOPE);
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent');

console.log('\n=== Nexora Gmail API Setup ===\n');
console.log('Step 1: Open this URL in your browser and authorize the Gmail account');
console.log('        that should send Nexora invitation emails:\n');
console.log(authUrl.toString());
console.log('\nStep 2: After authorizing, Google will show you a code. Paste it below.\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question('Authorization code: ', async (code) => {
  rl.close();
  code = code.trim();
  if (!code) { console.error('No code provided.'); process.exit(1); }

  const params = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
  });

  const options = {
    hostname: 'oauth2.googleapis.com',
    path: '/token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(params.toString()),
    },
  };

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(data); } catch { parsed = {}; }

      if (parsed.error) {
        console.error('\nERROR from Google:', parsed.error, '-', parsed.error_description || '');
        console.error('\nCommon causes:');
        console.error('  - Code already used (each code is single-use)');
        console.error('  - redirect_uri mismatch in Google Cloud Console');
        console.error('  - Gmail API not enabled: https://console.cloud.google.com/apis/library/gmail.googleapis.com');
        process.exit(1);
      }

      if (!parsed.refresh_token) {
        console.error('\nNo refresh_token returned. This usually means:');
        console.error('  - The Gmail account already authorized this app previously');
        console.error('  - Go to https://myaccount.google.com/permissions and revoke access');
        console.error('  - Then run this script again');
        process.exit(1);
      }

      console.log('\n=== SUCCESS ===\n');
      console.log('Set this as GMAIL_REFRESH_TOKEN in Railway (API service variables):\n');
      console.log(parsed.refresh_token);
      console.log('\nDo NOT commit this to Git. Set it only in Railway environment variables.');
      console.log('\nAlso ensure these are set on the Railway API service:');
      console.log('  GOOGLE_CLIENT_ID     — already configured');
      console.log('  GOOGLE_CLIENT_SECRET — already configured');
      console.log(`  EMAIL_USER           — the Gmail address that just authorized (${process.env.EMAIL_USER || 'check .env'})`);
      console.log('  GMAIL_REFRESH_TOKEN  — paste the token above');
      console.log('\nThen redeploy Railway and the invitation emails will send via Gmail API.\n');
    });
  });

  req.on('error', (err) => {
    console.error('Network error:', err.message);
    process.exit(1);
  });

  req.write(params.toString());
  req.end();
});
