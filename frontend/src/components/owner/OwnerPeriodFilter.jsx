import { useState } from "react";
import { todayStr, daysAgoStr } from "@/lib/api";

const MONTH_NAMES = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

/**
 * Filter periode halaman Pantauan Pemilik: **Bulan** atau **Tanggal**.
 *
 * Murni UI — hanya memanggil `onApply` dengan parameter periode terpilih dan
 * tidak pernah mengubah data. Dipisahkan dari halaman Owner supaya pengujian
 * bisa membaca testid-nya secara eksplisit.
 *
 * @param {(payload: {month?: number, year?: number, start?: string, end?: string}) => void} onApply
 */
export default function OwnerPeriodFilter({ onApply, initialMode = "month" }) {
  const now = new Date();
  const [mode, setMode] = useState(initialMode === "range" ? "range" : "month");
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [from, setFrom] = useState(daysAgoStr(6));
  const [to, setTo] = useState(todayStr());

  const apply = (event) => {
    event.preventDefault();
    if (mode === "range") {
      onApply({ start: from, end: to });
      return;
    }
    onApply({ month: Number(month), year: Number(year) });
  };

  return (
    <form
      onSubmit={apply}
      data-testid="owner-period-filter"
      className="relative z-10 mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4"
    >
      <label className="flex min-w-40 flex-col gap-1.5 text-sm font-medium text-muted-foreground">
        Filter berdasarkan
        <select
          data-testid="owner-period-filter-mode"
          value={mode}
          onChange={(event) => setMode(event.target.value)}
          className="h-10 w-full cursor-pointer rounded-lg border border-border bg-background px-3 text-base text-foreground"
        >
          <option value="month">Bulan</option>
          <option value="range">Tanggal</option>
        </select>
      </label>

      {mode === "range" ? (
        <>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-muted-foreground">
            Tanggal Mulai
            <input
              data-testid="owner-period-filter-start"
              required
              type="date"
              value={from}
              max={to || undefined}
              onChange={(event) => setFrom(event.target.value)}
              className="h-10 rounded-lg border border-border bg-background px-3 text-base text-foreground"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-muted-foreground">
            Tanggal Selesai
            <input
              data-testid="owner-period-filter-end"
              required
              type="date"
              value={to}
              min={from || undefined}
              onChange={(event) => setTo(event.target.value)}
              className="h-10 rounded-lg border border-border bg-background px-3 text-base text-foreground"
            />
          </label>
        </>
      ) : (
        <>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-muted-foreground">
            Bulan
            <select
              data-testid="owner-period-filter-month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              className="h-10 cursor-pointer rounded-lg border border-border bg-background px-3 text-base text-foreground"
            >
              {MONTH_NAMES.map((name, index) => (
                <option key={name} value={index + 1}>{name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-muted-foreground">
            Tahun
            <input
              data-testid="owner-period-filter-year"
              required
              type="number"
              min="1"
              max="9999"
              value={year}
              onChange={(event) => setYear(event.target.value)}
              className="h-10 w-28 rounded-lg border border-border bg-background px-3 text-base text-foreground"
            />
          </label>
        </>
      )}

      <button
        data-testid="owner-period-filter-apply"
        type="submit"
        className="relative z-10 h-10 cursor-pointer rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
      >
        Terapkan
      </button>
    </form>
  );
}
