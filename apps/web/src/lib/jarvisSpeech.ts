/**
 * Jarvis TTS facade — delegates to the centralized voice controller.
 * Keep imports stable for existing callers/tests.
 */

export {
  speakJarvis,
  speakNexoraReliable,
  enableAndSpeak,
  interruptJarvisVoice,
  interruptNexoraSpeech,
  pickJarvisVoice,
  pickMaleVoice,
  ensureSpeechVoices,
  setJarvisVoiceMuted,
  isJarvisVoiceMuted,
  isJarvisSpeaking,
  getSpeakGeneration,
  __resetJarvisVoiceForTests,
  type VoiceSpeakOptions as SpeakOptions,
  type VoiceSpeakResult as SpeakOutcome,
  type VoiceSpeakStatus as SpeakStatus,
} from '@/lib/jarvisVoiceController';
