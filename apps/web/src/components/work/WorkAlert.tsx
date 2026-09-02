import { cn } from '@/lib/utils';

export function WorkAlert({
  variant = 'error',
  children,
  role = 'alert',
}: {
  variant?: 'error' | 'success' | 'info';
  children: React.ReactNode;
  role?: 'alert' | 'status';
}) {
  return (
    <div
      role={role}
      className={cn(
        variant === 'error' && 'nx-alert-error',
        variant === 'success' && 'nx-alert-success',
        variant === 'info' && 'nx-alert-info'
      )}
    >
      {children}
    </div>
  );
}
