export const PageHeader = ({ title, subtitle, children }) => (
  <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div className="fade-up">
      <h1 data-testid="page-title" className="text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">{title}</h1>
      {subtitle && <p className="mt-1.5 text-sm text-muted-foreground sm:text-base">{subtitle}</p>}
    </div>
    {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
  </div>
);

export const StatCard = ({ label, value, hint, tone = "", testid }) => (
  <div className="rounded-2xl border border-border bg-card p-5">
    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
    <p data-testid={testid} className={`mt-2 font-mono text-2xl font-semibold tracking-tight ${tone}`}>{value}</p>
    {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
  </div>
);

export const Empty = ({ text, testid }) => (
  <div data-testid={testid} className="rounded-2xl border border-dashed border-border px-6 py-14 text-center text-sm text-muted-foreground">
    {text}
  </div>
);
