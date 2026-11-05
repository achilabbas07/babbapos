import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg, num, rp } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function InventoryOpnameDialog({ open, onOpenChange, items, onSaved }) {
  const [physicalQty, setPhysicalQty] = useState({});
  const [notes, setNotes] = useState({});
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  const handleDownloadPDF = async () => {
    try {
      const { downloadStockOpnamePDF } = await import("@/lib/stockOpnamePdf");
      downloadStockOpnamePDF(result);
    } catch (error) {
      toast.error(errMsg(error));
    }
  };

  useEffect(() => {
    if (open) {
      setPhysicalQty({});
      setNotes({});
      setResult(null);
    }
  }, [open]);

  const submit = async (event) => {
    event.preventDefault();
    const payload = items
      .filter((item) => physicalQty[item.id] !== undefined && physicalQty[item.id] !== "")
      .map((item) => ({
        item_id: item.id,
        physical_qty: Number(physicalQty[item.id]),
        notes: notes[item.id] || "",
      }));

    if (!payload.length) {
      toast.error("Isi stok fisik minimal satu bahan sebelum menyimpan.");
      return;
    }

    setSaving(true);
    try {
      const { data } = await api.post("/inventory/opname", payload);
      setResult(data);
      onSaved(data);
      toast.success("Stok opname berhasil disimpan.");
    } catch (error) {
      toast.error(errMsg(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>{result ? "Hasil Stok Opname" : "Mulai Stok Opname"}</DialogTitle>
        </DialogHeader>
        {result ? (
          <>
            <p className="text-sm text-muted-foreground">
              Disimpan {new Date(result.created_at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}
            </p>
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nama Barang</TableHead>
                    <TableHead className="text-right">Stok Sistem</TableHead>
                    <TableHead className="text-right">Stok Fisik</TableHead>
                    <TableHead className="text-right">Selisih</TableHead>
                    <TableHead className="text-right">Nilai Kerugian</TableHead>
                    <TableHead>Keterangan</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.items.map((item) => (
                    <TableRow key={item.item_id}>
                      <TableCell>{item.item_name}</TableCell>
                      <TableCell className="text-right">{num(item.system_qty)} {item.unit}</TableCell>
                      <TableCell className="text-right">{num(item.physical_qty)} {item.unit}</TableCell>
                      <TableCell className="text-right">{num(item.difference)} {item.unit}</TableCell>
                      <TableCell className="text-right">{Number(item.loss_value) > 0 ? rp(item.loss_value) : "-"}</TableCell>
                      <TableCell>{item.notes || "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleDownloadPDF}>
                <Download className="h-4 w-4" />Unduh Laporan PDF
              </Button>
              <Button type="button" onClick={() => onOpenChange(false)}>Tutup</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="grid gap-4">
            <p className="text-sm text-muted-foreground">
              Masukkan stok fisik bahan yang dihitung. Baris yang tidak diisi tidak akan disertakan.
            </p>
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Bahan</TableHead>
                    <TableHead className="text-right">Stok Sistem</TableHead>
                    <TableHead>Stok Fisik</TableHead>
                    <TableHead>Keterangan</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <p className="font-medium">{item.name}</p>
                        <p className="text-xs text-muted-foreground">{item.unit}</p>
                      </TableCell>
                      <TableCell className="text-right font-mono">{num(item.stock)} {item.unit}</TableCell>
                      <TableCell>
                        <Input
                          aria-label={`Stok fisik ${item.name}`}
                          type="number"
                          min="0"
                          step="any"
                          value={physicalQty[item.id] ?? ""}
                          onChange={(event) => setPhysicalQty((current) => ({ ...current, [item.id]: event.target.value }))}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          aria-label={`Keterangan ${item.name}`}
                          type="text"
                          maxLength={500}
                          value={notes[item.id] ?? ""}
                          onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                  {!items.length && (
                    <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">Belum ada bahan baku untuk diopname.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={saving || !items.length}>
                {saving ? "Menyimpan..." : "Simpan Hasil Opname"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
