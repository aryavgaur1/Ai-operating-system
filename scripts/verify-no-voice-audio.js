/**
 * Regression: Nexora web app must not invoke browser speech, microphone, or Jarvis audio UI.
 * Run: node scripts/verify-no-voice-audio.js
 */
const fs = require('fs');
const path = require('path');

const WEB_SRC = path.join(__dirname, '../apps/web/src');

/** Forbidden in app source — substring match (case-sensitive where noted). */
const FORBIDDEN = [
  { pattern: 'speechSynthesis', label: 'speechSynthesis API' },
  { pattern: 'SpeechSynthesisUtterance', label: 'SpeechSynthesisUtterance' },
  { pattern: 'SpeechRecognition', label: 'SpeechRecognition API' },
  { pattern: 'webkitSpeechRecognition', label: 'webkitSpeechRecognition' },
  { pattern: 'getUserMedia', label: 'getUserMedia (microphone)' },
  { pattern: 'MediaRecorder', label: 'MediaRecorder' },
  { pattern: 'AudioContext', label: 'AudioContext' },
  { pattern: 'speakNexora', label: 'speakNexora TTS helper' },
  { pattern: 'stopNexoraSpeech', label: 'stopNexoraSpeech' },
  { pattern: 'NexoraPresence', label: 'NexoraPresence component' },
  { pattern: 'JarvisLayer', label: 'JarvisLayer' },
  { pattern: 'JarvisProvider', label: 'JarvisProvider' },
  { pattern: 'jarvisWake', label: 'wake-word module' },
  { pattern: 'jarvisSpeech', label: 'jarvisSpeech module' },
  { pattern: 'jarvisVoice', label: 'jarvisVoice module' },
  { pattern: 'toggleMicrophone', label: 'toggleMicrophone' },
  { pattern: 'shouldAutoSpeakReply', label: 'shouldAutoSpeakReply' },
  { pattern: 'shouldSpeakAgentReply', label: 'shouldSpeakAgentReply' },
];

const FORBIDDEN_FILES = [
  'components/NexoraPresence.tsx',
  'lib/nexoraVoice.ts',
  'lib/jarvisSpeech.ts',
  'lib/jarvisVoiceController.ts',
  'lib/jarvisWake.ts',
  'lib/jarvisGreeting.ts',
  'components/JarvisLayer.tsx',
  'components/JarvisProvider.tsx',
];

function walk(dir, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, acc);
    else if (/\.(tsx?|css)$/.test(name)) acc.push(full);
  }
  return acc;
}

let failed = 0;

for (const rel of FORBIDDEN_FILES) {
  const full = path.join(WEB_SRC, rel);
  if (fs.existsSync(full)) {
    failed += 1;
    console.error('FAIL forbidden file still exists:', rel);
  }
}

const files = walk(WEB_SRC);
for (const file of files) {
  const rel = path.relative(WEB_SRC, file);
  const text = fs.readFileSync(file, 'utf8');
  for (const { pattern, label } of FORBIDDEN) {
    if (text.includes(pattern)) {
      failed += 1;
      const line = text.slice(0, text.indexOf(pattern)).split('\n').length;
      console.error(`FAIL ${rel}:${line} contains ${label} (${pattern})`);
    }
  }
}

// ChatWorkspace must not import lucide mic/volume icons (sound UI removed)
const chatPath = path.join(WEB_SRC, 'components/ChatWorkspace.tsx');
if (fs.existsSync(chatPath)) {
  const chat = fs.readFileSync(chatPath, 'utf8');
  if (/\bVolume2\b/.test(chat) || /\bVolumeX\b/.test(chat) || /\bMic\b/.test(chat)) {
    failed += 1;
    console.error('FAIL ChatWorkspace still references Volume2, VolumeX, or Mic icons');
  }
}

if (failed) {
  console.error(`\n${failed} no-voice-audio check(s) failed.`);
  process.exit(1);
}

console.log(`PASS scanned ${files.length} web source files — no speech/mic/Jarvis audio APIs`);
console.log('PASS forbidden Jarvis/voice component files absent');
console.log('\nAll no-voice-audio checks passed.');
