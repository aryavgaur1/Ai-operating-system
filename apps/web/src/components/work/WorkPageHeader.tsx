export function WorkPageHeader({
  eyebrow = 'Workspace',
  title,
  description,
  meta,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  meta?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="nx-eyebrow">{eyebrow}</p>
        <h1 className="nx-title mt-2">{title}</h1>
        {description ? <p className="nx-description">{description}</p> : null}
      </div>
      {meta ? <div className="text-sm text-neutral-400">{meta}</div> : null}
    </header>
  );
}
