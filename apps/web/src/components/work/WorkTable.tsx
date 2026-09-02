import { cn } from '@/lib/utils';

export function WorkTable({
  columns,
  children,
  className,
  caption,
}: {
  columns: string[];
  children: React.ReactNode;
  className?: string;
  caption?: string;
}) {
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr className="border-b border-white/10 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
            {columns.map((col) => (
              <th key={col} scope="col" className="px-4 py-2.5 font-medium">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">{children}</tbody>
      </table>
    </div>
  );
}

export function WorkTableRow({
  children,
  onClick,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  const interactive = Boolean(onClick);

  return (
    <tr
      onClick={onClick}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      tabIndex={interactive ? 0 : undefined}
      role={interactive ? 'button' : undefined}
      className={cn(
        'transition-colors hover:bg-white/[0.03]',
        interactive && 'cursor-pointer focus-visible:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40',
        className
      )}
    >
      {children}
    </tr>
  );
}

export function WorkTableCell({
  children,
  className,
  colSpan,
}: {
  children: React.ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} className={cn('px-4 py-3 align-top text-neutral-300', className)}>
      {children}
    </td>
  );
}
