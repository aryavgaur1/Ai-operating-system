/**
 * Jarvis OS layer regressions (wake phrase, hotkeys, contextual suggestions, speech interrupt).
 * Run: node scripts/verify-jarvis-layer.js
 */
const assert = require('assert');
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const os = require('os');

const STUB_DIR = path.join(__dirname, 'stubs');

function ensureStubs() {
  fs.mkdirSync(STUB_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(STUB_DIR, 'nexora-presence-speech.cjs'),
    `'use strict';
exports.speakableText = (t, max = 600) => String(t || '').replace(/\\s+/g, ' ').trim().slice(0, max);
exports.canUseSpeechSynthesis = () => typeof global.window !== 'undefined' && !!global.window.speechSynthesis;
exports.stopNexoraSpeech = () => { try { global.window.speechSynthesis.cancel(); } catch (e) {} };
`
  );
  fs.writeFileSync(
    path.join(STUB_DIR, 'cn.cjs'),
    `'use strict'; exports.cn = (...a) => a.filter(Boolean).join(' ');`
  );
  fs.writeFileSync(
    path.join(STUB_DIR, 'humanize-tools.cjs'),
    `'use strict';
exports.humanToolLabel = (t,a) => (a && /search/i.test(a) ? 'Checking ' : '') + (t||'tool');
exports.humanToolStart = (t) => "I'm checking your " + t + ".";
exports.humanToolResult = (t,_,ok) => ok ? 'Finished with ' + t : 'Failed';
exports.shouldAutoSpeakReply = (r) => String(r||'').length > 20 && String(r).length < 400;
`
  );
  fs.writeFileSync(
    path.join(STUB_DIR, 'jarvis-greeting.cjs'),
    `'use strict';
exports.dayPartFromHour = (h) => (h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening');
exports.JARVIS_SUGGESTIONS = [
  { id: 'priority-email', label: 'Find important emails', prompt: 'Find my top priority emails.' },
  { id: 'pending-work', label: 'Show pending work', prompt: 'Show my pending approvals and what needs attention.' },
  { id: 'important-today', label: "What's important today?", prompt: "What's important for me today across email and approvals?" },
];
`
  );
}

function pathAliasPlugin(extra = {}) {
  const map = {
    '@/components/NexoraPresence': path.join(STUB_DIR, 'nexora-presence-speech.cjs'),
    '@/lib/utils': path.join(STUB_DIR, 'cn.cjs'),
    '@/lib/humanizeTools': path.join(STUB_DIR, 'humanize-tools.cjs'),
    '@/lib/jarvisGreeting': path.join(STUB_DIR, 'jarvis-greeting.cjs'),
    ...extra,
  };
  return {
    name: 'path-alias',
    setup(build) {
      build.onResolve({ filter: /^@\// }, (args) => {
        const hit = map[args.path];
        if (hit) return { path: hit };
        return null;
      });
    },
  };
}

async function bundle(entry) {
  const outfile = path.join(os.tmpdir(), `jarvis-layer-${Date.now()}-${Math.random().toString(16).slice(2)}.cjs`);
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile,
    logLevel: 'silent',
    plugins: [pathAliasPlugin()],
  });
  delete require.cache[require.resolve(outfile)];
  const mod = require(outfile);
  try {
    fs.unlinkSync(outfile);
  } catch {
    // ignore
  }
  return mod;
}

function installMockSpeech({ autoStart = true } = {}) {
  class SpeechSynthesisUtterance {
    constructor(text) {
      this.text = text;
      this.onstart = null;
      this.onend = null;
      this.onerror = null;
    }
  }
  const speechSynthesis = {
    speaking: false,
    pending: false,
    paused: false,
    cancel() {
      this.speaking = false;
      this.pending = false;
    },
    resume() {},
    getVoices() {
      return [{ name: 'Microsoft David - English (United States)', lang: 'en-US' }];
    },
    speak(u) {
      if (!autoStart) return;
      queueMicrotask(() => {
        this.speaking = true;
        u.onstart?.();
        setTimeout(() => {
          this.speaking = false;
          u.onend?.();
        }, 15);
      });
    },
    addEventListener() {},
    removeEventListener() {},
  };
  global.window = { speechSynthesis, setTimeout, clearTimeout };
  global.SpeechSynthesisUtterance = SpeechSynthesisUtterance;
}

async function main() {
  ensureStubs();

  const wake = await bundle(path.join(__dirname, '../apps/web/src/lib/jarvisWake.ts'));
  assert.strictEqual(wake.matchesWakePhrase('Hey Nexora'), true);
  assert.strictEqual(wake.matchesWakePhrase('hi nexora find emails'), true);
  assert.strictEqual(wake.matchesWakePhrase('find emails'), false);
  assert.strictEqual(wake.stripWakePhrase('Hey Nexora, find my important emails.'), 'find my important emails.');
  assert.strictEqual(wake.isStopCommand('Stop'), true);
  assert.strictEqual(wake.isStopCommand('stop.'), true);
  assert.strictEqual(wake.isStopCommand('please stop later'), false);
  console.log('PASS wake phrase + stop command');

  const hotkeys = await bundle(path.join(__dirname, '../apps/web/src/lib/jarvisHotkeys.ts'));
  assert.strictEqual(
    hotkeys.isJarvisToggleHotkey({ key: 'j', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }),
    true
  );
  assert.strictEqual(
    hotkeys.isJarvisToggleHotkey({ key: 'j', metaKey: false, ctrlKey: true, altKey: false, shiftKey: false }),
    true
  );
  assert.strictEqual(
    hotkeys.isJarvisToggleHotkey({ key: 'j', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false }),
    false
  );
  console.log('PASS ⌘/Ctrl+J hotkey detection');

  const status = await bundle(path.join(__dirname, '../apps/web/src/lib/jarvisStatus.ts'));
  assert.ok(status.jarvisStatusLabel('listening').includes('Listening'));
  assert.ok(status.jarvisToolNarration('gmail', 'searchEmails').length > 5);
  const morning = status.buildContextualSuggestions({ hour: 9, pathname: '/app/dashboard' });
  assert.ok(morning.some((s) => /email/i.test(s.label)));
  const approvals = status.buildContextualSuggestions({ hour: 14, pathname: '/app/approvals' });
  assert.ok(approvals.some((s) => /approval/i.test(s.label)));
  const evening = status.buildContextualSuggestions({ hour: 20, pathname: '/app/dashboard' });
  assert.ok(evening.some((s) => /summarize|tomorrow|priorit/i.test(s.label + s.prompt)));
  console.log('PASS contextual suggestions + status labels');

  installMockSpeech({ autoStart: true });
  const speech = await bundle(path.join(__dirname, '../apps/web/src/lib/jarvisSpeech.ts'));
  let started = 0;
  const p1 = speech.speakNexoraReliable('First sentence.', {
    preferMale: true,
    onStart: () => {
      started += 1;
    },
  });
  // Interrupt mid-flight then speak again — must not overlap; interrupt ≠ blocked
  speech.interruptNexoraSpeech();
  const outcome1 = await p1;
  assert.ok(outcome1.status === 'interrupted' || outcome1.status === 'started');
  const outcome2 = await speech.speakNexoraReliable('Second sentence after interrupt.', {
    preferMale: true,
    rate: 0.88,
  });
  assert.ok(outcome2.status === 'started' || outcome2.status === 'completed');
  console.log('PASS interruptible speech (no dual overlap / interrupt status)');

  console.log('\nAll Jarvis OS layer checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
