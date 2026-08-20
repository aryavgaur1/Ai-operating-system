/**
 * Authoritative Jarvis conversation / voice states.
 * UI and mic/TTS must not invent conflicting local states.
 */

export type JarvisPhase =
  | 'sleeping'
  | 'waking'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'error';

export type NexoraAgentState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'tool'
  | 'speaking'
  | 'success'
  | 'error';

/** Map OS-layer phase → existing presence visual states. */
export function phaseToAgentState(phase: JarvisPhase): NexoraAgentState {
  switch (phase) {
    case 'listening':
    case 'waking':
      return 'listening';
    case 'processing':
      return 'thinking';
    case 'speaking':
      return 'speaking';
    case 'error':
      return 'error';
    case 'sleeping':
    default:
      return 'idle';
  }
}

export function phaseStatusLabel(phase: JarvisPhase, custom?: string | null): string {
  if (custom) return custom;
  switch (phase) {
    case 'waking':
      return 'Waking…';
    case 'listening':
      return 'Listening…';
    case 'processing':
      return 'Thinking…';
    case 'speaking':
      return 'Speaking…';
    case 'error':
      return 'Something went wrong';
    case 'sleeping':
    default:
      return 'Ready';
  }
}
