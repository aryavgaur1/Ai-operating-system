'use strict';
exports.speakableText = (t, max = 600) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, max);
exports.canUseSpeechSynthesis = () => typeof global.window !== 'undefined' && !!global.window.speechSynthesis;
exports.stopNexoraSpeech = () => { try { global.window.speechSynthesis.cancel(); } catch (e) {} };
