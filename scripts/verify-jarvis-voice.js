/**
 * Sentence-chunk TTS + wake helpers.
 * Run: node scripts/verify-jarvis-voice.js
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
exports.canUseSpeechSynthesis = () => typeof global.window !== 'undefined' && !!global.window.speechSynthesis;
exports.speakableText = (t, max=2500) => String(t||'').replace(/\\s+/g,' ').trim().slice(0,max);
`
  );
  fs.writeFileSync(
    path.join(STUB_DIR, 'jarvis-log.cjs'),
    `'use strict'; exports.jarvisLog = () => {};`
  );
}

function aliasPlugin() {
  return {
    name: 'a',
    setup(b) {
      b.onResolve({ filter: /^@\// }, (args) => {
        if (args.path.includes('NexoraPresence')) return { path: path.join(STUB_DIR, 'nexora-presence-speech.cjs') };
        if (args.path.includes('jarvisLog')) return { path: path.join(STUB_DIR, 'jarvis-log.cjs') };
        return null;
      });
    },
  };
}

async function load(entry) {
  const outfile = path.join(os.tmpdir(), `jv-${Date.now()}.cjs`);
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile,
    logLevel: 'silent',
    plugins: [aliasPlugin()],
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

function installMock() {
  class SpeechSynthesisUtterance {
    constructor(text) {
      this.text = text;
      this.onstart = null;
      this.onend = null;
      this.onerror = null;
    }
  }
  const spoken = [];
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
      return [
        { name: 'Microsoft Zira - English (United States)', lang: 'en-US' },
        { name: 'Microsoft Ravi - English (India)', lang: 'en-IN' },
        { name: 'Microsoft David - English (United States)', lang: 'en-US' },
      ];
    },
    speak(u) {
      spoken.push(u.text);
      this.pending = true;
      queueMicrotask(() => {
        this.speaking = true;
        this.pending = false;
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
  global.window = { speechSynthesis, setTimeout, clearTimeout, setInterval, clearInterval, localStorage: { getItem: () => null } };
  global.SpeechSynthesisUtterance = SpeechSynthesisUtterance;
  return { spoken };
}

async function main() {
  ensureStubs();

  const voice = await load(path.join(__dirname, '../apps/web/src/lib/jarvisVoiceController.ts'));
  const chunks = voice.splitIntoSpeechChunks(
    'Hi Aryav. Good morning. I am Nexora. How can I help you today? I can check Gmail, Slack, and Jira.'
  );
  assert.ok(chunks.length >= 3, 'multi-sentence must produce multiple chunks');
  assert.ok(chunks[0].toLowerCase().includes('hi') || chunks[0].toLowerCase().includes('good'));
  assert.ok(chunks.some((c) => /nexora/i.test(c)));
  assert.ok(chunks.some((c) => /help/i.test(c)));
  console.log('PASS sentence chunking does not drop later sentences');

  {
    installMock();
    voice.__resetJarvisVoiceForTests();
    const mock = installMock();
    const full =
      'Hi Aryav. I am Nexora. How can I help you today? I can find important emails and show pending work.';
    const result = await voice.speakJarvis(full, { interrupt: true, rate: 0.9 });
    assert.strictEqual(result.status, 'completed');
    assert.ok(mock.spoken.length >= 2, 'must speak multiple chunks, not only Hi');
    assert.ok(mock.spoken.join(' ').toLowerCase().includes('help'));
    console.log('PASS full greeting speaks beyond first sentence');
  }

  {
    installMock();
    voice.__resetJarvisVoiceForTests();
    // Mute API must NOT cancel speech
    voice.setJarvisVoiceMuted(true);
    const r = await voice.speakJarvis('Good morning. This should still speak when output mute API is legacy.', {
      interrupt: true,
    });
    assert.strictEqual(r.status, 'completed');
    console.log('PASS setJarvisVoiceMuted does not cancel TTS');
  }

  const wake = await load(path.join(__dirname, '../apps/web/src/lib/jarvisWake.ts'));
  assert.strictEqual(wake.matchesWakePhrase('Hey Jarvis'), true);
  assert.strictEqual(wake.isWakeOnly('Hey Jarvis'), true);
  assert.strictEqual(wake.isWakeOnly('Hey Jarvis, find emails'), false);
  assert.strictEqual(wake.stripWakePhrase('Hey Jarvis, find my important emails.'), 'find my important emails.');
  console.log('PASS Hey Jarvis wake detection');

  console.log('\nAll Jarvis conversational voice checks passed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
