export function WorkLoading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-6 text-sm text-neutral-500" role="status" aria-live="polite">
      <span className="nx-skel h-4 w-4 rounded-full" aria-hidden />
      <span>{label}</span>
    </div>
  );
}
