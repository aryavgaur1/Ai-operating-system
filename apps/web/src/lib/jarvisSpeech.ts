/**
 * Jarvis TTS facade — delegates to the centralized voice controller.
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
  splitIntoSpeechChunks,
  prepareSpeakableText,
  __resetJarvisVoiceForTests,
  type VoiceSpeakOptions as SpeakOptions,
  type VoiceSpeakResult as SpeakOutcome,
  type VoiceSpeakStatus as SpeakStatus,
  type CancelReason,
} from '@/lib/jarvisVoiceController';
