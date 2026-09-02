'use client';

import { FileUp, Send, Square } from 'lucide-react';
import { cn } from '@/lib/utils';

const EXAMPLES = [
  'Create a launch war room for Project Atlas on Slack',
  'Find my priority emails',
  'Create a Jira ticket',
  'Draft a project update',
  'Update the product document',
];

export function CommandInput({
  value,
  onChange,
  onSubmit,
  onStop,
  onAttach,
  loading,
  uploading,
  disabled,
  hasAttachments,
  fileInputRef,
  onFileChange,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  onAttach?: () => void;
  loading?: boolean;
  uploading?: boolean;
  disabled?: boolean;
  hasAttachments?: boolean;
  fileInputRef?: React.RefObject<HTMLInputElement>;
  onFileChange?: (file: File | null) => void;
}) {
  return (
    <div className="nx-panel shadow-none">
      <div className="border-b border-white/10 px-4 py-2.5">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-neutral-500">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
          Command surface
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="p-3 sm:p-4"
        aria-label="Command input"
      >
        <div className="flex gap-2 sm:gap-3">
          {onAttach ? (
            <>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".pdf,.docx,.txt,.md,.markdown,.csv,.tsv,.json,.xlsx,.xls,.png,.jpg,.jpeg,.webp,.gif,.ts,.tsx,.js,.jsx,.py,.sql,.html,.css,.yaml,.yml,text/*,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/*"
                onChange={(e) => onFileChange?.(e.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                title="Attach a file"
                aria-label="Attach a file"
                disabled={uploading || loading}
                onClick={onAttach}
                className="focus-ring flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-white/10 text-neutral-500 transition hover:border-white/20 hover:text-white disabled:opacity-40"
              >
                <FileUp size={16} />
              </button>
            </>
          ) : null}

          <label htmlFor="command-input" className="sr-only">
            Command message
          </label>
          <textarea
            id="command-input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSubmit();
              }
            }}
            rows={2}
            placeholder="Tell Nexora what you need…"
            className="focus-ring min-h-[52px] flex-1 resize-none rounded-md border border-transparent bg-transparent px-1 text-sm leading-6 text-white placeholder:text-neutral-500 focus:border-white/10 sm:text-[15px]"
            disabled={disabled}
            aria-busy={loading}
          />

          {loading ? (
            <button
              type="button"
              onClick={onStop}
              title="Stop"
              aria-label="Stop execution"
              className="focus-ring flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-white/15 bg-white/5 text-white transition hover:bg-white/10"
            >
              <Square size={14} />
            </button>
          ) : (
            <button
              type="submit"
              disabled={disabled || (!value.trim() && !hasAttachments)}
              aria-label="Send command"
              className={cn('nx-btn-primary h-11 w-11 shrink-0 p-0', 'disabled:cursor-not-allowed disabled:opacity-40')}
            >
              <Send size={15} />
            </button>
          )}
        </div>
      </form>

      <div className="flex flex-wrap gap-2 border-t border-white/10 px-3 py-3 sm:px-4" role="group" aria-label="Example commands">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => onChange(ex)}
            className="focus-ring rounded-md border border-white/10 bg-white/[0.02] px-2.5 py-1 text-xs text-neutral-400 transition hover:border-white/15 hover:text-neutral-200"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}
