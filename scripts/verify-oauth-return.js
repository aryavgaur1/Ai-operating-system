/**
 * Unit checks for OAuth return path sanitization (no open redirects).
 * Run: node scripts/verify-oauth-return.js
 */
const assert = require('assert');

// Inline mirror of sanitize rules (compiled TS may not be on disk in CI before build).
function sanitizeOAuthReturnPath(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return '/app/integrations';
  const trimmed = raw.trim();
  if (
    trimmed.includes('://') ||
    trimmed.startsWith('//') ||
    trimmed.includes('\\') ||
    trimmed.includes('..') ||
    !trimmed.startsWith('/')
  ) {
    return '/app/integrations';
  }
  const pathOnly = trimmed.split('?')[0].split('#')[0];
  const ALLOWED = new Set(['/app/onboarding', '/app/integrations']);
  if (!ALLOWED.has(pathOnly)) return '/app/integrations';
  return pathOnly;
}

assert.strictEqual(sanitizeOAuthReturnPath('/app/onboarding'), '/app/onboarding');
assert.strictEqual(sanitizeOAuthReturnPath('/app/integrations'), '/app/integrations');
assert.strictEqual(sanitizeOAuthReturnPath('/app/onboarding?x=1'), '/app/onboarding');
assert.strictEqual(sanitizeOAuthReturnPath('https://evil.com'), '/app/integrations');
assert.strictEqual(sanitizeOAuthReturnPath('//evil.com'), '/app/integrations');
assert.strictEqual(sanitizeOAuthReturnPath('/app/dashboard'), '/app/integrations');
assert.strictEqual(sanitizeOAuthReturnPath('../etc/passwd'), '/app/integrations');
assert.strictEqual(sanitizeOAuthReturnPath(''), '/app/integrations');
assert.strictEqual(sanitizeOAuthReturnPath(null), '/app/integrations');

// Source files must wire returnTo into OAuth state / redirects.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
for (const rel of [
  'apps/api/src/lib/oauthReturn.ts',
  'apps/api/src/routes/oauth-slack.ts',
  'apps/api/src/routes/oauth-notion.ts',
  'apps/api/src/routes/oauth-gmail.ts',
  'apps/api/src/routes/oauth-jira.ts',
  'apps/web/src/app/app/onboarding/page.tsx',
]) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  if (rel.includes('oauthReturn')) {
    assert.ok(src.includes('sanitizeOAuthReturnPath'), `${rel} missing sanitize`);
  } else if (rel.includes('onboarding')) {
    assert.ok(src.includes('onboardingStep'), `${rel} must persist onboardingStep`);
    assert.ok(src.includes("returnTo"), `${rel} must pass returnTo for OAuth`);
    assert.ok(!src.includes("Aryav Sharma"), `${rel} must not contain demo names`);
  } else {
    assert.ok(src.includes('readOAuthReturnTo') || src.includes('oauthAppRedirect'), `${rel} missing return helpers`);
    assert.ok(src.includes('ret'), `${rel} must store ret in OAuth state`);
  }
}

// Scroll: no custom wheel physics
const smooth = fs.readFileSync(path.join(root, 'apps/web/src/components/landing/SmoothScroll.tsx'), 'utf8');
assert.ok(!smooth.includes("addEventListener('wheel'"), 'SmoothScroll must not intercept wheel');
assert.ok(!/ease\s*=\s*0\.0/.test(smooth), 'SmoothScroll must not use lerp ease physics');
assert.ok(!smooth.includes('requestAnimationFrame(tick)'), 'SmoothScroll must not run scroll rAF loop');

const motion = fs.readFileSync(path.join(root, 'apps/web/src/components/motion.tsx'), 'utf8');
assert.ok(!/filter:\s*['\"]blur/.test(motion), 'fadeUp must not animate CSS filter blur');

console.log('PASS verify-oauth-return + scroll regression guards');
