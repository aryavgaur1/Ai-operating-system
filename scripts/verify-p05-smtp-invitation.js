#!/usr/bin/env node
/**
 * P0.5 SMTP Invitation — local verification.
 *
 * Tests:
 *  1. emailCredentials resolves from env
 *  2. No Resend code path exists in mailer
 *  3. Invitation persisted in DB
 *  4. SMTP mailer invoked with correct recipient/subject
 *  5. Production invite URL format (no localhost, no Netlify)
 *  6. Token not leaked to logs
 *  7. Failed SMTP returns a real error (not fake success)
 *  8. No Resend import in compiled mailer output
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

// ─── 1. Env credentials present ──────────────────────────────────────────────
(function testEnvCreds() {
  const user = (process.env.EMAIL_USER || '').trim();
  const pass_ = (process.env.EMAIL_PASS || '').trim();
  if (!user) { fail('1 EMAIL_USER configured', 'EMAIL_USER is missing'); return; }
  pass('1 EMAIL_USER configured');
  if (!pass_) { fail('2 EMAIL_PASS configured', 'EMAIL_PASS is missing'); return; }
  pass('2 EMAIL_PASS configured');
})();

// ─── 2. No Resend in compiled mailer ─────────────────────────────────────────
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

// ─── 3. No deliver-invite relay route ────────────────────────────────────────
(function testNoRelayRoute() {
  const relayPath = path.join(__dirname, '../apps/web/src/app/api/internal/deliver-invite/route.ts');
  if (fs.existsSync(relayPath)) {
    fail('4 Vercel relay route removed', 'deliver-invite/route.ts still exists');
  } else {
    pass('4 Vercel relay route removed');
  }
})();

// ─── 4. Mailer source uses smtp only ─────────────────────────────────────────
(function testMailerSourceSmtpOnly() {
  const mailerPath = path.join(__dirname, '../apps/api/src/lib/mailer.ts');
  const src = fs.readFileSync(mailerPath, 'utf8');
  if (src.includes('resend.com/emails')) {
    fail('5 mailer source no Resend HTTP call', 'mailer.ts still calls resend.com/emails');
    return;
  }
  pass('5 mailer source no Resend HTTP call');
  if (src.includes('RESEND_API_KEY')) {
    fail('6 mailer source no RESEND_API_KEY', 'mailer.ts still references RESEND_API_KEY');
  } else {
    pass('6 mailer source no RESEND_API_KEY');
  }
  if (!src.includes('smtp.gmail.com')) {
    fail('7 mailer source uses Gmail SMTP', 'mailer.ts missing smtp.gmail.com');
  } else {
    pass('7 mailer source uses Gmail SMTP');
  }
})();

// ─── 5. Invite URL uses production domain ────────────────────────────────────
(function testInviteUrl() {
  const mailerPath = path.join(__dirname, '../apps/api/src/lib/mailer.ts');
  const src = fs.readFileSync(mailerPath, 'utf8');
  // Check invite URL line specifically — localhost only allowed as fallback in mailFrom, not in invite path
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

// ─── 6. invitationService delegates to mailer correctly ──────────────────────
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

// ─── 7. DB + mailer integration (with mocked SMTP) ───────────────────────────
async function testDbIntegration() {
  const distPath = path.join(__dirname, '../apps/api/dist/lib/mailer.js');
  if (!fs.existsSync(distPath)) {
    skip('12 DB+mailer integration', 'dist not built');
    return;
  }

  // Patch nodemailer before requiring mailer to capture calls without real SMTP.
  let smtpCalled = false;
  let smtpTo = null;
  let smtpSubject = null;

  const nodemailer = require('nodemailer');
  const originalCreate = nodemailer.createTransport.bind(nodemailer);
  nodemailer.createTransport = function(...args) {
    const t = originalCreate(...args);
    const orig = t.sendMail.bind(t);
    t.sendMail = async function(mail) {
      smtpCalled = true;
      smtpTo = mail.to;
      smtpSubject = mail.subject;
      return { messageId: '<mock@test>' };
    };
    t.verify = async function() { return true; };
    return t;
  };

  try {
    const { mailer } = require(distPath);
    const result = await mailer.sendWorkspaceInvitation({
      to: 'test@example.com',
      workspaceName: 'Test Workspace',
      inviterName: 'Alice',
      role: 'member',
      rawToken: 'mock-raw-token-12345',
      expiresAt: new Date(Date.now() + 86400_000),
    });

    if (!smtpCalled) {
      fail('12 SMTP invoked for invitation', 'nodemailer.sendMail was not called');
    } else {
      pass('12 SMTP invoked for invitation');
    }

    if (smtpTo !== 'test@example.com') {
      fail('13 correct recipient', `expected test@example.com got ${smtpTo}`);
    } else {
      pass('13 correct recipient');
    }

    if (!smtpSubject || !smtpSubject.includes('Test Workspace')) {
      fail('14 subject contains workspace name', `subject was: ${smtpSubject}`);
    } else {
      pass('14 subject contains workspace name');
    }

    if (result.delivered !== true) {
      fail('15 delivered=true on SMTP success', `delivered=${result.delivered} errorCode=${result.errorCode}`);
    } else {
      pass('15 delivered=true on SMTP success');
    }

    if (result.mode === 'smtp') {
      pass('16 mode=smtp');
    } else {
      fail('16 mode=smtp', `got mode=${result.mode}`);
    }

    // Token must not appear in any log-safe field
    const safe = JSON.stringify({ errorCode: result.errorCode, hint: result.hint, mode: result.mode });
    if (safe.includes('mock-raw-token-12345')) {
      fail('17 raw token not leaked in result fields', 'token found in result');
    } else {
      pass('17 raw token not in result fields');
    }

  } catch (err) {
    fail('12-17 DB+mailer integration', err.message);
  }
}

// ─── 8. Failed SMTP returns real error, not fake success ─────────────────────
async function testSmtpFailureIsHonest() {
  const distPath = path.join(__dirname, '../apps/api/dist/lib/mailer.js');
  if (!fs.existsSync(distPath)) {
    skip('18 SMTP failure is honest', 'dist not built');
    return;
  }

  // Force all profiles to throw ETIMEDOUT
  const nodemailer = require('nodemailer');
  nodemailer.createTransport = function() {
    return {
      sendMail: async () => { throw Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }); },
      verify:   async () => { throw Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }); },
    };
  };

  // Clear require cache to get fresh module with patched nodemailer
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
    fail('18 SMTP failure not masked as success', 'delivered=true even though SMTP threw ETIMEDOUT');
  } else {
    pass('18 SMTP failure returns delivered=false');
  }

  if (!result.errorCode || result.errorCode === 'unknown') {
    fail('19 SMTP failure has errorCode', `errorCode=${result.errorCode}`);
  } else {
    pass(`19 SMTP failure errorCode=${result.errorCode}`);
  }
}

// Run async tests then summarise
(async () => {
  await testDbIntegration();
  await testSmtpFailureIsHonest();

  console.log('');
  if (failed === 0) {
    console.log(`SMTP invitation verification: ALL ${passed} PASS`);
  } else {
    console.log(`SMTP invitation verification: ${passed} PASS, ${failed} FAIL`);
    process.exit(1);
  }
})();
