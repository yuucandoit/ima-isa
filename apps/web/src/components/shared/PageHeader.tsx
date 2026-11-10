export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string
  title: string
  description?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-4 pb-6 lg:flex-row lg:items-end lg:justify-between">
      <div className="space-y-1.5">
        {eyebrow ? (
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary/80">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[28px]">
          {title}
        </h1>
        {description ? (
          <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground sm:text-[13px]">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}
