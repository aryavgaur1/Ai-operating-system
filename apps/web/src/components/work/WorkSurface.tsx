import { cn } from '@/lib/utils';

/** Static work surface — no motion or hover lift. */
export function WorkSurface({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn('nx-panel', className)}>{children}</div>;
}
