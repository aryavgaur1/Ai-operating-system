/** Keyboard shortcuts for the global Jarvis OS layer. */

export function isJarvisToggleHotkey(event: KeyboardEvent): boolean {
  if (event.defaultPrevented) return false;
  const key = event.key?.toLowerCase();
  if (key !== 'j') return false;
  // ⌘+J (Mac) or Ctrl+J (Windows/Linux) — ignore when typing in inputs unless meta/ctrl
  const mod = event.metaKey || event.ctrlKey;
  if (!mod) return false;
  if (event.altKey || event.shiftKey) return false;
  return true;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest('[contenteditable="true"]'));
}
