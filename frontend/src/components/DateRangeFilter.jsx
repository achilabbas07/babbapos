import { DATE_RANGE_PRESETS } from "@/lib/dateRangePresets";

/**
 * Filter rentang tanggal yang dipakai bersama oleh halaman Pembelian,
 * Pengeluaran, dan Riwayat Shift.
 *
 * Nilai `from`/`to` adalah tanggal kalender lokal (`YYYY-MM-DD`). String kosong
 * berarti tanpa batas pada sisi tersebut, sehingga perilaku default halaman
 * (tanpa filter) tetap sama.
 */
export default function DateRangeFilter({ from, to, onChange, testidPrefix = "date-filter" }) {
  const setFrom = (value) => onChange({ from: value, to });
  const setTo = (value) => onChange({ from, to: value });

  const isActive = (preset) => {
    const r = preset.range();
    return r.from === from && r.to === to;
  };

  return (
    <div
      data-testid={testidPrefix}
      className="mb-5 flex flex-wrap items-end gap-2 rounded-xl border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        {DATE_RANGE_PRESETS.map((preset) => (
          <button
            key={preset.key}
            type="button"
            data-testid={`${testidPrefix}-preset-${preset.key}`}
            onClick={() => onChange(preset.range())}
            className={`h-10 rounded-lg px-3 text-sm ${
              isActive(preset)
                ? "bg-primary text-primary-foreground"
                : "border border-border text-muted-foreground hover:border-primary"
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
        Dari
        <input
          data-testid={`${testidPrefix}-from`}
          type="date"
          value={from}
          max={to || undefined}
          onChange={(e) => setFrom(e.target.value)}
          className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
        Sampai
        <input
          data-testid={`${testidPrefix}-to`}
          type="date"
          value={to}
          min={from || undefined}
          onChange={(e) => setTo(e.target.value)}
          className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
        />
      </label>
    </div>
  );
}
