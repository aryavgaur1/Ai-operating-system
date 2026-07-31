'use client';

import { Fragment } from 'react';

function renderInline(text: string, keyPrefix: string) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean);
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={`${keyPrefix}-${i}`} className="code rounded-md bg-white/10 px-1.5 py-0.5 text-[0.85em] text-accent2">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={`${keyPrefix}-${i}`} className="font-semibold text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return (
        <em key={`${keyPrefix}-${i}`} className="italic text-neutral-200">
          {part.slice(1, -1)}
        </em>
      );
    }
    return <Fragment key={`${keyPrefix}-${i}`}>{part}</Fragment>;
  });
}

export function MarkdownLite({ content }: { content: string }) {
  const blocks = content.split(/```/g);

  return (
    <div className="space-y-3">
      {blocks.map((block, i) => {
        const isCode = i % 2 === 1;
        if (isCode) {
          const lines = block.replace(/^\w+\n/, '');
          return (
            <pre
              key={i}
              className="code overflow-x-auto rounded-2xl border border-white/10 bg-black/50 p-4 text-xs leading-6 text-emerald-200"
            >
              {lines.trim()}
            </pre>
          );
        }
        const lines = block.split('\n').filter((l) => l.trim().length > 0);
        return (
          <div key={i} className="space-y-1.5">
            {lines.map((line, j) => {
              if (line.trim().startsWith('- ')) {
                return (
                  <div key={j} className="flex items-start gap-2">
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" />
                    <span>{renderInline(line.replace(/^\s*-\s+/, ''), `${i}-${j}`)}</span>
                  </div>
                );
              }
              if (/^#{1,3}\s/.test(line.trim())) {
                const level = line.trim().match(/^#+/)?.[0].length ?? 1;
                const cleanText = line.replace(/^#+\s*/, '');
                const cls = level === 1 ? 'text-lg font-semibold text-white' : 'text-sm font-semibold text-white';
                return (
                  <div key={j} className={cls}>
                    {renderInline(cleanText, `${i}-${j}`)}
                  </div>
                );
              }
              return <p key={j}>{renderInline(line, `${i}-${j}`)}</p>;
            })}
          </div>
        );
      })}
    </div>
  );
}
