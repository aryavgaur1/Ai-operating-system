/**
 * Jarvis greeting session + copy regressions (no browser).
 * Run: node scripts/verify-jarvis-greeting.js
 */
const assert = require('assert');
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const os = require('os');

async function loadGreetingModule() {
  const outfile = path.join(os.tmpdir(), `jarvis-greeting-${Date.now()}.cjs`);
  await esbuild.build({
    entryPoints: [path.join(__dirname, '../apps/web/src/lib/jarvisGreeting.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile,
    logLevel: 'silent',
  });
  const mod = require(outfile);
  try {
    fs.unlinkSync(outfile);
  } catch {
    // ignore
  }
  return mod;
}

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

async function main() {
  const {
    dayPartFromHour,
    firstNameFromDisplayName,
    buildJarvisGreeting,
    shouldPresentGreeting,
    markGreetingPresented,
    markGreetingSpoken,
    readGreetingSession,
    clearGreetingSession,
    setPendingJarvisPrompt,
    consumePendingJarvisPrompt,
    hasAutoSpeakAttempted,
    markAutoSpeakAttempted,
    clearAutoSpeakAttempts,
  } = await loadGreetingModule();

  assert.strictEqual(dayPartFromHour(8), 'morning');
  assert.strictEqual(dayPartFromHour(14), 'afternoon');
  assert.strictEqual(dayPartFromHour(20), 'evening');
  console.log('PASS day parts');

  assert.strictEqual(firstNameFromDisplayName('Aryav Gaur'), 'Aryav');
  assert.strictEqual(firstNameFromDisplayName('  Priya  '), 'Priya');
  assert.strictEqual(firstNameFromDisplayName(null), null);
  assert.strictEqual(firstNameFromDisplayName(''), null);
  assert.strictEqual(firstNameFromDisplayName('user'), null);
  console.log('PASS real displayName parsing (no hardcoded Aryav required)');

  const morning = buildJarvisGreeting({ displayName: 'Aryav Gaur', hour: 9 });
  assert.ok(morning.spokenText.includes('Good morning, Aryav'));
  assert.ok(morning.spokenText.includes("I'm Nexora"));
  assert.ok(!/Hello user/i.test(morning.spokenText));
  assert.ok(!/provide your query/i.test(morning.spokenText));

  const anon = buildJarvisGreeting({ displayName: null, hour: 15 });
  assert.ok(anon.spokenText.startsWith('Good afternoon'));
  assert.ok(!anon.spokenText.includes('null'));
  assert.ok(anon.firstName === null);
  console.log('PASS greeting copy uses real name / anonymous fallback');

  const storage = memoryStorage();
  assert.strictEqual(shouldPresentGreeting('user-1', storage), true);
  markGreetingPresented('user-1', storage, { spoken: false });
  assert.strictEqual(shouldPresentGreeting('user-1', storage), false);
  assert.strictEqual(shouldPresentGreeting('user-2', storage), true);
  console.log('PASS once-per-session + different user greets again');

  // Workspace refresh / remount simulation — same user must not re-present
  markGreetingPresented('user-1', storage);
  assert.strictEqual(shouldPresentGreeting('user-1', storage), false);
  console.log('PASS workspace switch / remount does not re-greet');

  markGreetingSpoken('user-1', storage);
  const rec = readGreetingSession(storage);
  assert.strictEqual(rec.spoken, true);
  assert.strictEqual(rec.presented, true);
  console.log('PASS spoken flag only after explicit markGreetingSpoken (speech onstart)');

  // Logout clears session → next login greets
  clearGreetingSession(storage);
  clearAutoSpeakAttempts();
  assert.strictEqual(shouldPresentGreeting('user-1', storage), true);
  console.log('PASS logout/login produces a new session greeting');

  // Auto-speak lock
  assert.strictEqual(hasAutoSpeakAttempted('user-1'), false);
  markAutoSpeakAttempted('user-1');
  assert.strictEqual(hasAutoSpeakAttempted('user-1'), true);
  clearAutoSpeakAttempts();
  assert.strictEqual(hasAutoSpeakAttempted('user-1'), false);
  console.log('PASS auto-speak attempt lock clears on logout');

  setPendingJarvisPrompt(storage, 'Find my top priority emails.');
  assert.strictEqual(consumePendingJarvisPrompt(storage), 'Find my top priority emails.');
  assert.strictEqual(consumePendingJarvisPrompt(storage), null);
  console.log('PASS suggestion prompt handoff to chat pipeline');

  console.log('\nAll Jarvis greeting checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
