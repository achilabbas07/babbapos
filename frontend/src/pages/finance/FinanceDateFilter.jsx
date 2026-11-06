import { useState } from "react";

export default function FinanceDateFilter({ onApply, initialMode = "range" }) {
  const [mode, setMode] = useState(initialMode);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [year, setYear] = useState(String(new Date().getFullYear()));

  const apply = (event) => {
    event.preventDefault();
    if (mode === "range") {
      onApply({ start, end });
    } else {
      onApply({ month: Number(month), year: Number(year) });
    }
  };

  return (
    <form onSubmit={apply} className="relative z-10 mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
      <label className="flex min-w-40 flex-col gap-1.5 text-sm font-medium">
        Filter berdasarkan
        <select value={mode} onChange={(event) => setMode(event.target.value)} className="h-10 w-full cursor-pointer rounded-lg border border-border bg-background px-3">
          <option value="range">Rentang tanggal</option>
          <option value="month">Periode bulan</option>
        </select>
      </label>
      {mode === "range" ? (
        <>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Tanggal Mulai
            <input required type="date" value={start} onChange={(event) => setStart(event.target.value)} className="h-10 cursor-pointer rounded-lg border border-border bg-background px-3" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Tanggal Selesai
            <input required type="date" min={start || undefined} value={end} onChange={(event) => setEnd(event.target.value)} className="h-10 cursor-pointer rounded-lg border border-border bg-background px-3" />
          </label>
        </>
      ) : (
        <>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Bulan
            <select value={month} onChange={(event) => setMonth(event.target.value)} className="h-10 cursor-pointer rounded-lg border border-border bg-background px-3">
              {Array.from({ length: 12 }, (_, index) => (
                <option key={index + 1} value={index + 1}>
                  {new Date(2000, index).toLocaleDateString("id-ID", { month: "long" })}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Tahun
            <input required type="number" min="1" max="9999" value={year} onChange={(event) => setYear(event.target.value)} className="h-10 w-28 rounded-lg border border-border bg-background px-3" />
          </label>
        </>
      )}
      <button type="submit" className="relative z-10 h-10 cursor-pointer rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">Terapkan</button>
    </form>
  );
}
