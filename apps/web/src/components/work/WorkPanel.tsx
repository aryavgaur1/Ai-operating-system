export function WorkPanel({
  title,
  action,
  children,
  className,
  flush,
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <section className={className ? `nx-panel ${className}` : 'nx-panel'}>
      {title ? (
        <div className="nx-panel-header">
          <h2 className="nx-panel-title">{title}</h2>
          {action}
        </div>
      ) : null}
      <div className={title && !flush ? 'nx-panel-body' : 'p-0'}>{children}</div>
    </section>
  );
}
