/**
 * Jarvis speech lifecycle regressions with a mock SpeechSynthesis.
 * Run: node scripts/verify-jarvis-speech.js
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
}

function pathAliasPlugin() {
  const map = {
    '@/components/NexoraPresence': path.join(STUB_DIR, 'nexora-presence-speech.cjs'),
    '@/lib/utils': path.join(STUB_DIR, 'cn.cjs'),
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

async function loadSpeechModule() {
  const outfile = path.join(os.tmpdir(), `jarvis-speech-${Date.now()}.cjs`);
  await esbuild.build({
    entryPoints: [path.join(__dirname, '../apps/web/src/lib/jarvisSpeech.ts')],
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

function installMockSpeech({ autoStart = true, failError = null, neverStart = false } = {}) {
  const voices = [
    { name: 'Google UK English Female', lang: 'en-GB' },
    { name: 'Microsoft David - English (United States)', lang: 'en-US' },
    { name: 'Samantha', lang: 'en-US' },
  ];
  const spoken = [];

  class SpeechSynthesisUtterance {
    constructor(text) {
      this.text = text;
      this.rate = 1;
      this.pitch = 1;
      this.lang = 'en-US';
      this.voice = null;
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
    resume() {
      this.paused = false;
    },
    getVoices() {
      return voices;
    },
    speak(utterance) {
      spoken.push(utterance.text);
      if (neverStart) {
        this.pending = false;
        this.speaking = false;
        return;
      }
      this.pending = true;
      if (failError) {
        queueMicrotask(() => {
          this.pending = false;
          utterance.onerror?.({ error: failError });
        });
        return;
      }
      if (autoStart) {
        queueMicrotask(() => {
          this.speaking = true;
          this.pending = false;
          utterance.onstart?.();
          setTimeout(() => {
            this.speaking = false;
            utterance.onend?.();
          }, 20);
        });
      }
    },
    addEventListener() {},
    removeEventListener() {},
  };

  global.window = {
    speechSynthesis,
    setTimeout,
    clearTimeout,
  };
  global.SpeechSynthesisUtterance = SpeechSynthesisUtterance;
  global.SpeechSynthesisErrorEvent = class {};

  return { spoken, speechSynthesis, voices };
}

async function main() {
  ensureStubs();

  {
    const mock = installMockSpeech({ autoStart: true });
    const { pickMaleVoice, speakNexoraReliable } = await loadSpeechModule();
    const male = pickMaleVoice(mock.voices);
    assert.ok(male && /david|daniel|mark|ravi|alex|male/i.test(male.name), 'should prefer male voice');
    console.log('PASS male voice preference');

    let started = false;
    const outcome = await speakNexoraReliable('Good morning, Aryav. I am Nexora.', {
      preferMale: true,
      onStart: () => {
        started = true;
      },
    });
    assert.ok(outcome.status === 'started' || outcome.status === 'completed');
    assert.strictEqual(started, true);
    assert.ok(mock.spoken.some((t) => /Good morning/.test(t)));
    console.log('PASS speak resolves started/completed after onstart');
  }

  {
    installMockSpeech({ neverStart: true });
    const { speakNexoraReliable } = await loadSpeechModule();
    const outcome = await speakNexoraReliable('Hello there.', { startTimeoutMs: 80 });
    assert.strictEqual(outcome.status, 'blocked');
    console.log('PASS browser speech failure handled as blocked (not started)');
  }

  {
    installMockSpeech({ failError: 'not-allowed' });
    const { speakNexoraReliable } = await loadSpeechModule();
    const outcome = await speakNexoraReliable('Hello again.', { startTimeoutMs: 500 });
    assert.strictEqual(outcome.status, 'blocked');
    console.log('PASS not-allowed maps to blocked');
  }

  {
    const mock = installMockSpeech({ autoStart: true });
    const { enableAndSpeak } = await loadSpeechModule();
    const outcome = await enableAndSpeak('Good evening. I am Nexora.');
    assert.ok(outcome.status === 'started' || outcome.status === 'completed');
    assert.ok(mock.spoken.length >= 1);
    console.log('PASS manual enable voice speaks pending greeting');
  }

  console.log('\nAll Jarvis speech checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
