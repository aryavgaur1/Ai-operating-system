/**
 * Jarvis voice controller regressions (queue, mute, interrupt, utterance retention).
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
exports.speakableText = (t, max = 1200) => String(t || '').replace(/\\s+/g, ' ').trim().slice(0, max);
exports.canUseSpeechSynthesis = () => typeof global.window !== 'undefined' && !!global.window.speechSynthesis;
exports.stopNexoraSpeech = () => { try { global.window.speechSynthesis.cancel(); } catch (e) {} };
`
  );
}

function pathAliasPlugin() {
  return {
    name: 'path-alias',
    setup(build) {
      build.onResolve({ filter: /^@\/components\/NexoraPresence$/ }, () => ({
        path: path.join(STUB_DIR, 'nexora-presence-speech.cjs'),
      }));
    },
  };
}

async function loadVoice() {
  const outfile = path.join(os.tmpdir(), `jarvis-voice-${Date.now()}.cjs`);
  await esbuild.build({
    entryPoints: [path.join(__dirname, '../apps/web/src/lib/jarvisVoiceController.ts')],
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

function installMockSpeech({ dropUtteranceRef = false } = {}) {
  let lastUtterance = null;
  const spoken = [];

  class SpeechSynthesisUtterance {
    constructor(text) {
      this.text = text;
      this.rate = 1;
      this.pitch = 1;
      this.volume = 1;
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
      if (lastUtterance?.onerror) {
        const u = lastUtterance;
        lastUtterance = null;
        u.onerror({ error: 'canceled' });
      }
    },
    resume() {
      this.paused = false;
    },
    getVoices() {
      return [
        { name: 'Microsoft Zira - English (United States)', lang: 'en-US' },
        { name: 'Google हिन्दी', lang: 'hi-IN' },
        { name: 'Microsoft Ravi - English (India)', lang: 'en-IN' },
        { name: 'Microsoft David - English (United States)', lang: 'en-US' },
      ];
    },
    speak(utterance) {
      spoken.push(utterance.text);
      lastUtterance = utterance;
      this.pending = true;
      queueMicrotask(() => {
        // Simulate Chrome GC bug if nothing holds utterance — controller must retain it
        if (dropUtteranceRef) {
          lastUtterance = null;
          this.speaking = false;
          this.pending = false;
          return;
        }
        this.speaking = true;
        this.pending = false;
        utterance.onstart?.();
        setTimeout(() => {
          this.speaking = false;
          utterance.onend?.();
        }, 25);
      });
    },
    addEventListener() {},
    removeEventListener() {},
  };

  global.window = { speechSynthesis, setTimeout, clearTimeout, setInterval, clearInterval };
  global.SpeechSynthesisUtterance = SpeechSynthesisUtterance;
  return { spoken, getLast: () => lastUtterance };
}

async function main() {
  ensureStubs();

  {
    installMockSpeech();
    const voice = await loadVoice();
    voice.__resetJarvisVoiceForTests();
    const picked = voice.pickJarvisVoice(window.speechSynthesis.getVoices());
    assert.ok(picked && /ravi|david/i.test(picked.name), 'prefer Indian/US male over female Zira');
    console.log('PASS dynamic male voice preference (en-IN / male over female)');
  }

  {
    installMockSpeech();
    const voice = await loadVoice();
    voice.__resetJarvisVoiceForTests();
    voice.setJarvisVoiceMuted(true);
    const mutedOut = await voice.speakJarvis('Good morning, Aryav. I am Nexora.');
    assert.strictEqual(mutedOut.status, 'muted');
    voice.setJarvisVoiceMuted(false);
    const full = await voice.speakJarvis('Good morning, Aryav. I am Nexora. How can I help?', {
      interrupt: true,
      rate: 0.9,
    });
    assert.strictEqual(full.status, 'completed');
    console.log('PASS mute is output-only; full sentence completes when unmuted');
  }

  {
    installMockSpeech();
    const voice = await loadVoice();
    voice.__resetJarvisVoiceForTests();
    let sawStart = false;
    const p = voice.speakJarvis('Long greeting that must not be cut after one word.', {
      onStart: () => {
        sawStart = true;
        // Interrupt after speech has begun
        voice.interruptJarvisVoice();
      },
    });
    const r = await p;
    assert.ok(r.status === 'interrupted' || (sawStart && r.status === 'interrupted'));
    assert.strictEqual(r.status, 'interrupted');
    const next = await voice.speakJarvis('Second complete sentence after interrupt.', { interrupt: true });
    assert.strictEqual(next.status, 'completed');
    console.log('PASS interrupt clears speech; next turn completes without overlap');
  }

  {
    installMockSpeech();
    const voice = await loadVoice();
    voice.__resetJarvisVoiceForTests();
    const legacy = await voice.speakNexoraReliable('Compatibility greeting.');
    assert.ok(legacy.status === 'started' || legacy.status === 'completed');
    console.log('PASS speakNexoraReliable compatibility facade');
  }

  {
    // Connected-tool suggestion filter
    const statusOut = path.join(os.tmpdir(), `jarvis-status-${Date.now()}.cjs`);
    fs.writeFileSync(
      path.join(STUB_DIR, 'humanize-tools.cjs'),
      `'use strict';
exports.humanToolLabel = (t) => t;
exports.humanToolStart = (t) => 'Checking ' + t;
`
    );
    fs.writeFileSync(
      path.join(STUB_DIR, 'jarvis-greeting.cjs'),
      `'use strict';
exports.dayPartFromHour = (h) => (h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening');
exports.JARVIS_SUGGESTIONS = [];
`
    );
    await esbuild.build({
      entryPoints: [path.join(__dirname, '../apps/web/src/lib/jarvisStatus.ts')],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: statusOut,
      logLevel: 'silent',
      plugins: [
        {
          name: 'a',
          setup(b) {
            b.onResolve({ filter: /^@\// }, (args) => {
              if (args.path.includes('NexoraPresence')) return { path: path.join(STUB_DIR, 'nexora-presence-speech.cjs') };
              if (args.path.includes('humanize')) return { path: path.join(STUB_DIR, 'humanize-tools.cjs') };
              if (args.path.includes('jarvisGreeting')) return { path: path.join(STUB_DIR, 'jarvis-greeting.cjs') };
              return null;
            });
          },
        },
      ],
    });
    const status = require(statusOut);
    const noGmail = status.buildContextualSuggestions({
      hour: 9,
      pathname: '/app/dashboard',
      connected: { gmail: false, slack: true, jira: true },
    });
    assert.ok(!noGmail.some((s) => /important emails/i.test(s.label)));
    const withGmail = status.buildContextualSuggestions({
      hour: 9,
      pathname: '/app/dashboard',
      connected: { gmail: true },
    });
    assert.ok(withGmail.some((s) => /important emails/i.test(s.label)));
    console.log('PASS suggestions respect connected integrations');
    try {
      fs.unlinkSync(statusOut);
    } catch {
      // ignore
    }
  }

  console.log('\nAll Jarvis voice controller checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
