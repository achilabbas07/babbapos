import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, CalendarDays, ChevronDown, CircleDollarSign, LoaderCircle, TrendingDown, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { api, errMsg } from "@/lib/api";
import { FinanceError } from "./FinanceShared";

const ACTIVITY_GROUPS = [
  { key: "1. Aktivitas Operasional (CFO)", title: "Aktivitas Operasional", code: "CFO", tone: "bg-blue-50 text-blue-700" },
  { key: "2. Aktivitas Investasi (CFI)", title: "Aktivitas Investasi", code: "CFI", tone: "bg-violet-50 text-violet-700" },
  { key: "3. Aktivitas Pendanaan (CFF)", title: "Aktivitas Pendanaan", code: "CFF", tone: "bg-amber-50 text-amber-700" },
];

const OPERATING_EXPENSE_GROUPS = [
  { key: "ingredients", title: "Beban Bahan Baku", pattern: /\b(bumbu|daging|sayur|bahan baku|bahan makanan|ingredient)\b/i },
  { key: "payroll", title: "Beban Gaji & Upah", pattern: /\b(gaji|upah|bonus|insentif|honor|tunjangan|payroll)\b/i },
  { key: "other", title: "Beban Utilitas & Operasional Lainnya", pattern: null },
];

const currencyFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const formatRupiah = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "-";
  return `${amount < 0 ? "-" : ""}${currencyFormatter.format(Math.abs(amount))}`;
};

const dateString = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const initialPeriod = () => {
  const today = new Date();
  return {
    start: dateString(new Date(today.getFullYear(), today.getMonth(), 1)),
    end: dateString(today),
  };
};

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const isCashFlowReport = (value) => (
  isRecord(value)
  && ACTIVITY_GROUPS.every(({ key }) => (
    isRecord(value[key])
    && Object.values(value[key]).every((amount) => amount !== null && Number.isFinite(Number(amount)))
  ))
  && value.Total_Bersih !== null
  && Number.isFinite(Number(value.Total_Bersih))
);

const getReportAmount = (report, keys) => {
  for (const key of keys) {
    const value = report[key];
    if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) continue;
    const amount = Number(value);
    if (Number.isFinite(amount)) return amount;
  }
  return null;
};

const operatingExpenseGroup = (name) => (
  OPERATING_EXPENSE_GROUPS.find(({ pattern }) => pattern?.test(name))?.key || "other"
);

const addReportedCashInToOperatingActivity = (report) => {
  const cashIn = getReportAmount(report, ["Total_Kas_Masuk", "total_kas_masuk", "cash_in", "money_in"]);
  if (cashIn === null || cashIn <= 0) return report;

  const operatingActivity = ACTIVITY_GROUPS.find(({ code }) => code === "CFO");
  const operatingKey = operatingActivity.key;

  return {
    ...report,
    [operatingKey]: {
      ...report[operatingKey],
      "Kas Masuk Teridentifikasi": cashIn,
    },
    Total_Bersih: Number(report.Total_Bersih) + cashIn,
  };
};

function CashFlowRows({ rows }) {
  if (!rows.length) {
    return <p className="px-4 py-3 text-sm text-muted-foreground sm:px-6">Tidak ada transaksi.</p>;
  }
  return (
    <div className="divide-y divide-border">
      {rows.map(({ name, value }) => (
        <div key={name} className="flex items-center justify-between gap-4 px-4 py-3 text-sm sm:px-6">
          <span className="min-w-0 text-muted-foreground">{name}</span>
          <span className={`shrink-0 font-mono font-medium tabular-nums ${value < 0 ? "text-red-600" : "text-green-600"}`}>
            {formatRupiah(value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function MovementBlock({ title, rows }) {
  return (
    <div>
      <h3 className="border-b border-border bg-secondary/20 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-6">
        {title}
      </h3>
      <CashFlowRows rows={rows} />
    </div>
  );
}

function ActivitySection({ group, rows, expanded, onToggle }) {
  const subtotal = rows.reduce((total, row) => total + row.value, 0);
  const inflows = rows.filter(({ value }) => value > 0);
  const outflows = rows.filter(({ value }) => value < 0);
  const neutral = rows.filter(({ value }) => value === 0);
  const operatingOutflows = group.code === "CFO"
    ? OPERATING_EXPENSE_GROUPS.map((category) => ({
      ...category,
      rows: outflows.filter(({ expenseGroup }) => expenseGroup === category.key),
    }))
    : [];
  const sectionId = `cash-flow-${group.code.toLowerCase()}`;

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={`${sectionId}-content`}
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left transition-colors hover:bg-secondary/30 sm:px-6"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-xs font-bold ${group.tone}`}>{group.code}</span>
          <span className="min-w-0">
            <span className="block font-semibold">{group.title}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{rows.length} akun</span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-3">
          <span className={`hidden font-mono text-sm font-semibold tabular-nums sm:inline ${subtotal < 0 ? "text-red-600" : "text-green-600"}`}>
            {formatRupiah(subtotal)}
          </span>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
        </span>
      </button>
      {expanded && (
        <div id={`${sectionId}-content`} className="border-t border-border">
          <div className="divide-y divide-border">
            <MovementBlock title="Kas Masuk" rows={inflows} />
            {group.code === "CFO" ? (
              <div>
                <h3 className="border-b border-border bg-secondary/20 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-6">
                  Kas Keluar
                </h3>
                {operatingOutflows.filter(({ rows: categoryRows }) => categoryRows.length > 0).map((category) => (
                  <div key={category.key}>
                    <p className="px-4 pt-3 text-xs font-semibold text-muted-foreground sm:px-6">{category.title}</p>
                    <CashFlowRows rows={category.rows} />
                  </div>
                ))}
                {!outflows.length && <p className="px-4 py-3 text-sm text-muted-foreground sm:px-6">Tidak ada transaksi.</p>}
              </div>
            ) : (
              <MovementBlock title="Kas Keluar" rows={outflows} />
            )}
            {neutral.length > 0 && <MovementBlock title="Nilai netral" rows={neutral} />}
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-border bg-secondary/30 px-4 py-3 text-sm font-semibold sm:px-6">
            <span>Total Kas Bersih dari {group.title}</span>
            <span className={`font-mono tabular-nums ${subtotal < 0 ? "text-red-600" : "text-green-600"}`}>{formatRupiah(subtotal)}</span>
          </div>
        </div>
      )}
    </section>
  );
}

export default function CashFlowStatement() {
  const [period, setPeriod] = useState(initialPeriod);
  const [draftPeriod, setDraftPeriod] = useState(initialPeriod);
  const [report, setReport] = useState(null);
  const [expandedGroups, setExpandedGroups] = useState(() => new Set(ACTIVITY_GROUPS.map(({ key }) => key)));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (signal) => {
    setError("");
    setLoading(true);
    try {
      const { data } = await api.get("/finance/cash-flow-statement", {
        params: period,
        signal,
      });
      if (process.env.NODE_ENV === "development") {
        console.debug("[CashFlowStatement] Payload:\n", JSON.stringify(data, null, 2));
        for (const { key, title } of ACTIVITY_GROUPS) {
          const accounts = data?.[key];
          console.groupCollapsed(`[CashFlowStatement] ${title} (${key})`);
          if (!isRecord(accounts)) {
            console.warn("Kategori tidak ada atau bukan objek:", accounts);
          } else {
            for (const [account, value] of Object.entries(accounts)) {
              console.log(account, { value, type: typeof value, numericValue: Number(value) });
            }
          }
          console.groupEnd();
        }
      }
      if (!isCashFlowReport(data)) {
        throw new Error("Format laporan arus kas dari server tidak valid.");
      }
      setReport(addReportedCashInToOperatingActivity(data));
    } catch (requestError) {
      if (requestError.code !== "ERR_CANCELED") {
        setError(errMsg(requestError));
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const activityRows = useMemo(() => (
    report
      ? ACTIVITY_GROUPS.map((group) => ({
        ...group,
        rows: Object.entries(report[group.key]).map(([name, value]) => {
          const amount = Number(value);
          return {
            name,
            value: amount,
            expenseGroup: amount < 0 ? operatingExpenseGroup(name) : null,
          };
        }),
      }))
      : []
  ), [report]);
  const reportedCashIn = report
    ? getReportAmount(report, ["Total_Kas_Masuk", "total_kas_masuk", "cash_in", "money_in"])
    : null;
  const calculatedCashIn = activityRows.reduce((total, group) => (
    total + group.rows.reduce((subtotal, row) => subtotal + Math.max(row.value, 0), 0)
  ), 0);
  const cashIn = reportedCashIn ?? calculatedCashIn;
  const cashOut = activityRows.reduce((total, group) => (
    total + group.rows.reduce((subtotal, row) => subtotal + Math.min(row.value, 0), 0)
  ), 0);

  const applyPeriod = (event) => {
    event.preventDefault();
    setPeriod(draftPeriod);
  };

  const toggleGroup = (key) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div>
      <PageHeader
        title="Laporan Arus Kas"
        subtitle="Pantau sumber dan penggunaan kas dari aktivitas operasional, investasi, dan pendanaan."
      />

      <form onSubmit={applyPeriod} className="mb-6 rounded-2xl border border-border bg-card p-4 sm:p-5">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold">
          <CalendarDays className="h-4 w-4 text-primary" />
          Periode laporan
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1 space-y-1.5 text-xs font-medium text-muted-foreground">
            Tanggal mulai
            <input
              required
              type="date"
              value={draftPeriod.start}
              max={draftPeriod.end || undefined}
              onChange={(event) => setDraftPeriod((current) => ({ ...current, start: event.target.value }))}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"
            />
          </label>
          <label className="flex-1 space-y-1.5 text-xs font-medium text-muted-foreground">
            Tanggal selesai
            <input
              required
              type="date"
              value={draftPeriod.end}
              min={draftPeriod.start || undefined}
              onChange={(event) => setDraftPeriod((current) => ({ ...current, end: event.target.value }))}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"
            />
          </label>
          <button
            type="submit"
            disabled={loading || !draftPeriod.start || !draftPeriod.end || draftPeriod.start > draftPeriod.end}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Activity className="h-4 w-4" />
            Terapkan filter
          </button>
        </div>
      </form>

      {error && <div className="mb-5"><FinanceError message={error} onRetry={() => load()} /></div>}

      {loading ? (
        <div role="status" className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-card text-sm text-muted-foreground">
          <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
          Memuat laporan arus kas...
        </div>
      ) : report && (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <TrendingUp className="h-4 w-4 text-green-600" />Kas masuk
              </div>
              <p className="mt-3 font-mono text-xl font-semibold tabular-nums text-green-600">{formatRupiah(cashIn)}</p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <TrendingDown className="h-4 w-4 text-red-600" />Kas keluar
              </div>
              <p className="mt-3 font-mono text-xl font-semibold tabular-nums text-red-600">{formatRupiah(cashOut)}</p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <CircleDollarSign className="h-4 w-4 text-primary" />Kenaikan bersih kas
              </div>
              <p className={`mt-3 font-mono text-xl font-semibold tabular-nums ${Number(report.Total_Bersih) < 0 ? "text-red-600" : "text-green-600"}`}>
                {formatRupiah(report.Total_Bersih)}
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {activityRows.map((group) => (
              <ActivitySection
                key={group.key}
                group={group}
                rows={group.rows}
                expanded={expandedGroups.has(group.key)}
                onToggle={() => toggleGroup(group.key)}
              />
            ))}
          </div>

          <div className="mt-5 flex flex-col gap-2 rounded-2xl border-t-2 border-slate-800 bg-slate-100 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Total kenaikan bersih kas</p>
              <p className="mt-1 text-sm text-slate-600">Perubahan kas bersih selama periode laporan</p>
            </div>
            <p className={`font-mono text-2xl font-bold tabular-nums ${Number(report.Total_Bersih) < 0 ? "text-red-600" : "text-green-600"}`}>
              {formatRupiah(report.Total_Bersih)}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
