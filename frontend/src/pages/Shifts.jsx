import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Printer } from "lucide-react";
import { api, errMsg, fmtDate, rp } from "@/lib/api";
import { ShiftPrintDialog } from "@/components/ShiftPrintDialog";
import { PageHeader, Empty } from "@/components/PageHeader";
import DateRangeFilter from "@/components/DateRangeFilter";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const diffTone = (d) => (d == null ? "" : d === 0 ? "text-emerald-600" : d > 0 ? "text-blue-600" : "text-destructive");

export default function Shifts() {
  const [list, setList] = useState([]);
  const [printing, setPrinting] = useState(null);
  const [range, setRange] = useState({ from: "", to: "" });
  const load = useCallback(() => {
    const params = {};
    if (range.from) params.start = range.from;
    if (range.to) params.end = range.to;
    return api.get("/shifts", { params }).then((r) => setList(r.data)).catch((e) => toast.error(errMsg(e)));
  }, [range]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <PageHeader title="Riwayat Shift Kasir" subtitle="Seharusnya = kas awal + penjualan tunai + kas masuk − kas keluar. Selisih = uang fisik − seharusnya." />
      <DateRangeFilter from={range.from} to={range.to} onChange={setRange} testidPrefix="shifts-date-filter" />
      {list.length === 0 ? <Empty testid="shifts-empty" text="Belum ada shift." /> : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Shift</TableHead><TableHead>Kasir</TableHead><TableHead>Waktu</TableHead><TableHead className="text-right">Kas awal</TableHead>
                <TableHead className="text-right">Tunai</TableHead><TableHead className="text-right">Non-tunai</TableHead><TableHead className="text-right">Masuk</TableHead>
                <TableHead className="text-right">Keluar</TableHead><TableHead className="text-right">Seharusnya</TableHead><TableHead className="text-right">Fisik</TableHead><TableHead className="text-right">Selisih</TableHead><TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((s) => (
                <TableRow key={s.id} data-testid={`shift-row-${s.id}`}>
                  <TableCell>
                    <p className="font-mono text-xs text-primary">{s.id}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${s.status === "open" ? "bg-emerald-100 text-emerald-700" : "bg-secondary text-muted-foreground"}`}>{s.status === "open" ? "Terbuka" : "Ditutup"}</span>
                  </TableCell>
                  <TableCell>{s.userName}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground"><p>{fmtDate(s.openedAt)}</p><p>{s.closedAt ? fmtDate(s.closedAt) : "—"}</p></TableCell>
                  <TableCell className="text-right font-mono">{rp(s.openingCash)}</TableCell>
                  <TableCell className="text-right font-mono">{rp(s.cashSales)}</TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">{rp(s.nonCashSales)}</TableCell>
                  <TableCell className="text-right font-mono">{rp(s.cashIn)}</TableCell>
                  <TableCell className="text-right font-mono">{rp(s.cashOut)}</TableCell>
                  <TableCell className="text-right font-mono font-semibold">{rp(s.expectedCash)}</TableCell>
                  <TableCell className="text-right font-mono">{s.countedCash == null ? "—" : rp(s.countedCash)}</TableCell>
                  <TableCell data-testid={`shift-diff-${s.id}`} className={`text-right font-mono font-semibold ${diffTone(s.difference)}`}>{s.difference == null ? "—" : rp(s.difference)}</TableCell>
                  <TableCell>
                    <button data-testid={`shift-reprint-${s.id}`} onClick={() => setPrinting(s)}
                      className="flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-3 text-xs font-medium hover:border-primary">
                      <Printer className="h-3.5 w-3.5" />Print Ulang
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <ShiftPrintDialog shift={printing} onClose={() => setPrinting(null)} />
    </div>
  );
}
