/**
 * Jarvis debug lifecycle logger — never logs secrets or email bodies.
 */
const PREFIX = '[JARVIS]';

export type JarvisLogEvent =
  | 'STATE'
  | 'WAKE_DETECTED'
  | 'LISTEN_START'
  | 'LISTEN_END'
  | 'TRANSCRIPT_FINAL'
  | 'AGENT_START'
  | 'AGENT_END'
  | 'TOOL'
  | 'TTS_START'
  | 'TTS_CHUNK'
  | 'TTS_END'
  | 'TTS_CANCEL'
  | 'TTS_ERROR'
  | 'MIC'
  | 'ERROR';

export function jarvisLog(event: JarvisLogEvent, detail?: Record<string, unknown> | string): void {
  if (typeof window === 'undefined') return;
  try {
    const enabled =
      process.env.NODE_ENV !== 'production' ||
      window.localStorage?.getItem('nexora.jarvis.debug') === '1';
    if (!enabled) return;
    if (typeof detail === 'string') {
      console.info(PREFIX, event, detail.slice(0, 120));
    } else {
      console.info(PREFIX, event, detail || '');
    }
  } catch {
    // ignore
  }
}
