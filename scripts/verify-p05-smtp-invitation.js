#!/usr/bin/env node
/**
 * P0.5 Gmail API Invitation — local verification.
 *
 * Tests:
 *  1–2.  Env credentials present (EMAIL_USER, GOOGLE_CLIENT_ID)
 *  3.    No Resend in compiled mailer
 *  4.    Vercel relay route removed
 *  5–6.  Mailer source: no Resend, no RESEND_API_KEY
 *  7.    Mailer source: references Gmail API endpoint (not SMTP)
 *  8–9.  Invite URL uses production domain (no localhost, no Netlify)
 *  10–11. invitationService delegates correctly
 *  12–17. Gmail API integration (mocked fetch — no real network)
 *  18–19. Failed Gmail API returns real error, not fake success
 */

'use strict';

require('dotenv').config();
const assert = require('assert');
const path = require('path');
const fs   = require('fs');

let passed = 0;
let failed = 0;

function pass(label) { console.log(`PASS ${label}`); passed++; }
function fail(label, reason) { console.error(`FAIL ${label}: ${reason}`); failed++; }
function skip(label, reason) { console.log(`SKIP ${label}: ${reason}`); }

// ─── 1-2. Env credentials present ────────────────────────────────────────────
(function testEnvCreds() {
  const user = (process.env.EMAIL_USER || '').trim();
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  if (!user) { fail('1 EMAIL_USER configured', 'EMAIL_USER is missing'); } else { pass('1 EMAIL_USER configured'); }
  if (!clientId) { fail('2 GOOGLE_CLIENT_ID configured', 'GOOGLE_CLIENT_ID is missing'); } else { pass('2 GOOGLE_CLIENT_ID configured'); }
})();

// ─── 3. No Resend in compiled mailer ─────────────────────────────────────────
(function testNoResendInDist() {
  const distPath = path.join(__dirname, '../apps/api/dist/lib/mailer.js');
  if (!fs.existsSync(distPath)) {
    skip('3 no Resend in compiled mailer', 'dist not built yet — run npm run build:api first');
    return;
  }
  const src = fs.readFileSync(distPath, 'utf8');
  if (src.includes('resend.com/emails') || src.includes('RESEND_API_KEY') || src.includes('resend_relay')) {
    fail('3 no Resend in compiled mailer', 'compiled mailer still references Resend API');
  } else {
    pass('3 no Resend in compiled mailer');
  }
})();

// ─── 4. No deliver-invite relay route ────────────────────────────────────────
(function testNoRelayRoute() {
  const relayPath = path.join(__dirname, '../apps/web/src/app/api/internal/deliver-invite/route.ts');
  if (fs.existsSync(relayPath)) {
    fail('4 Vercel relay route removed', 'deliver-invite/route.ts still exists');
  } else {
    pass('4 Vercel relay route removed');
  }
})();

// ─── 5-7. Mailer source: Gmail API, no Resend, no SMTP ───────────────────────
(function testMailerSource() {
  const mailerPath = path.join(__dirname, '../apps/api/src/lib/mailer.ts');
  const src = fs.readFileSync(mailerPath, 'utf8');
  if (src.includes('resend.com/emails')) {
    fail('5 mailer source no Resend HTTP call', 'mailer.ts still calls resend.com/emails');
  } else {
    pass('5 mailer source no Resend HTTP call');
  }
  if (src.includes('RESEND_API_KEY')) {
    fail('6 mailer source no RESEND_API_KEY', 'mailer.ts still references RESEND_API_KEY');
  } else {
    pass('6 mailer source no RESEND_API_KEY');
  }
  if (!src.includes('gmail.googleapis.com')) {
    fail('7 mailer source uses Gmail API', 'mailer.ts missing gmail.googleapis.com endpoint');
  } else {
    pass('7 mailer source uses Gmail API endpoint');
  }
})();

// ─── 8-9. Invite URL uses production domain ───────────────────────────────────
(function testInviteUrl() {
  const mailerPath = path.join(__dirname, '../apps/api/src/lib/mailer.ts');
  const src = fs.readFileSync(mailerPath, 'utf8');
  const inviteUrlLine = src.split('\n').find(l => l.includes('/invite/'));
  if (inviteUrlLine && inviteUrlLine.includes('localhost')) {
    fail('8 invite URL no localhost', 'invite URL line contains hardcoded localhost');
  } else {
    pass('8 invite URL delegates to webAppUrl() — no hardcoded localhost in invite path');
  }
  if (src.includes('netlify') || src.includes('netlify.app')) {
    fail('9 invite URL no Netlify', 'mailer references Netlify URL');
  } else {
    pass('9 invite URL no Netlify reference');
  }
})();

// ─── 10-11. invitationService delegates correctly ────────────────────────────
(function testInvitationServiceDelegation() {
  const svcPath = path.join(__dirname, '../apps/api/src/lib/invitationService.ts');
  const src = fs.readFileSync(svcPath, 'utf8');
  if (!src.includes('sendWorkspaceInvitation')) {
    fail('10 invitationService calls sendWorkspaceInvitation', 'sendWorkspaceInvitation not called');
  } else {
    pass('10 invitationService calls sendWorkspaceInvitation');
  }
  if (src.includes('deliverInviteViaWebRelay') || src.includes('deliver-invite')) {
    fail('11 invitationService no relay call', 'relay call still present in invitationService');
  } else {
    pass('11 invitationService no relay call');
  }
})();

// ─── 12-17. Gmail API integration (mocked fetch) ─────────────────────────────
async function testGmailApiIntegration() {
  const distPath = path.join(__dirname, '../apps/api/dist/lib/mailer.js');
  if (!fs.existsSync(distPath)) {
    skip('12 Gmail API integration', 'dist not built');
    return;
  }

  // Mock fetch to simulate successful Gmail API response
  let fetchCalled = false;
  let capturedTo = null;
  let capturedSubject = null;

  // Patch global fetch before requiring the module
  const originalFetch = global.fetch;
  global.fetch = async function(url, opts) {
    if (typeof url === 'string' && url.includes('oauth2.googleapis.com/token')) {
      return { ok: true, json: async () => ({ access_token: 'mock-access-token' }) };
    }
    if (typeof url === 'string' && url.includes('gmail.googleapis.com')) {
      fetchCalled = true;
      // Decode the MIME from the raw body to extract recipient/subject
      try {
        const body = JSON.parse(opts.body);
        const mime = Buffer.from(body.raw, 'base64').toString('utf8');
        const toLine = mime.split('\r\n').find(l => l.startsWith('To:'));
        const subjectLine = mime.split('\r\n').find(l => l.startsWith('Subject:'));
        capturedTo = toLine ? toLine.replace('To:', '').trim() : null;
        capturedSubject = subjectLine ? subjectLine.replace('Subject:', '').trim() : null;
      } catch {}
      return { ok: true, json: async () => ({ id: 'mock-gmail-id-123' }) };
    }
    return originalFetch ? originalFetch(url, opts) : Promise.reject(new Error('unexpected fetch: ' + url));
  };

  // Ensure env vars are set so gmailCredentials() returns non-null
  process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'mock-client-id';
  process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'mock-client-secret';
  process.env.EMAIL_USER = process.env.EMAIL_USER || 'nexora@gmail.com';
  process.env.GMAIL_REFRESH_TOKEN = 'mock-refresh-token';
  process.env.WEB_APP_URL = 'http://localhost:3000';

  // Clear require cache to get fresh module with patched fetch
  delete require.cache[distPath];
  const { mailer } = require(distPath);

  try {
    const result = await mailer.sendWorkspaceInvitation({
      to: 'test@example.com',
      workspaceName: 'Test Workspace',
      inviterName: 'Alice',
      role: 'member',
      rawToken: 'mock-raw-token-12345',
      expiresAt: new Date(Date.now() + 86400_000),
    });

    if (!fetchCalled) {
      fail('12 Gmail API called for invitation', 'gmail.googleapis.com was not called');
    } else {
      pass('12 Gmail API called for invitation');
    }

    if (capturedTo !== 'test@example.com') {
      fail('13 correct recipient', `expected test@example.com got ${capturedTo}`);
    } else {
      pass('13 correct recipient');
    }

    if (!capturedSubject || !capturedSubject.includes('Test Workspace')) {
      fail('14 subject contains workspace name', `subject was: ${capturedSubject}`);
    } else {
      pass('14 subject contains workspace name');
    }

    if (result.delivered !== true) {
      fail('15 delivered=true on Gmail API success', `delivered=${result.delivered} errorCode=${result.errorCode}`);
    } else {
      pass('15 delivered=true on Gmail API success');
    }

    if (result.mode === 'gmail_api') {
      pass('16 mode=gmail_api');
    } else {
      fail('16 mode=gmail_api', `got mode=${result.mode}`);
    }

    const safe = JSON.stringify({ errorCode: result.errorCode, hint: result.hint, mode: result.mode });
    if (safe.includes('mock-raw-token-12345')) {
      fail('17 raw token not leaked in result fields', 'token found in result');
    } else {
      pass('17 raw token not in result fields');
    }

  } catch (err) {
    fail('12-17 Gmail API integration', err.message);
  }

  global.fetch = originalFetch;
}

// ─── 18-19. Failed Gmail API returns real error, not fake success ─────────────
async function testGmailApiFailureIsHonest() {
  const distPath = path.join(__dirname, '../apps/api/dist/lib/mailer.js');
  if (!fs.existsSync(distPath)) {
    skip('18 Gmail API failure is honest', 'dist not built');
    return;
  }

  process.env.GMAIL_REFRESH_TOKEN = 'mock-refresh-token';

  const originalFetch = global.fetch;
  global.fetch = async function(url) {
    if (typeof url === 'string' && url.includes('oauth2.googleapis.com/token')) {
      return { ok: true, json: async () => ({ access_token: 'mock-access-token' }) };
    }
    if (typeof url === 'string' && url.includes('gmail.googleapis.com')) {
      return {
        ok: false,
        json: async () => ({ error: { status: 'PERMISSION_DENIED', message: 'Insufficient Permission' } }),
      };
    }
    return originalFetch ? originalFetch(url) : Promise.reject(new Error('unexpected fetch: ' + url));
  };

  delete require.cache[distPath];
  const { mailer } = require(distPath);

  const result = await mailer.sendWorkspaceInvitation({
    to: 'test@example.com',
    workspaceName: 'Fail Test',
    inviterName: 'Bob',
    role: 'member',
    rawToken: 'fail-token-xyz',
    expiresAt: new Date(Date.now() + 86400_000),
  });

  if (result.delivered === true) {
    fail('18 Gmail API failure not masked as success', 'delivered=true even though Gmail API returned error');
  } else {
    pass('18 Gmail API failure returns delivered=false');
  }

  if (!result.errorCode || result.errorCode === 'unknown') {
    fail('19 Gmail API failure has errorCode', `errorCode=${result.errorCode}`);
  } else {
    pass(`19 Gmail API failure errorCode=${result.errorCode}`);
  }

  global.fetch = originalFetch;
}

// Run async tests then summarise
(async () => {
  await testGmailApiIntegration();
  await testGmailApiFailureIsHonest();

  console.log('');
  if (failed === 0) {
    console.log(`Gmail API invitation verification: ALL ${passed} PASS`);
  } else {
    console.log(`Gmail API invitation verification: ${passed} PASS, ${failed} FAIL`);
    process.exit(1);
  }
})();
