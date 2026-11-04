import { Printer } from "lucide-react";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fmtDate, itemName, rp } from "@/lib/api";
import { printBluetoothReceipt } from "@/lib/bluetoothThermalPrinter";
import { BrandLogo } from "@/components/BrandLogo";
import { useProfile } from "@/context/ProfileContext";
import { supabase } from "@/supabaseClient";
import {
  buildKitchenTicketLines,
  buildOpenBillLines,
  incrementPrintCount,
  printCountKey,
  readPrintCount,
  wrapPrintText,
} from "@/lib/thermalPrint";

export const PrintTicketDialog = ({ bill, tableName, mode, onClose }) => {
  const kitchen = mode === "kitchen";
  const { profile } = useProfile();
  const [, setPrintRevision] = useState(0);
  const [printing, setPrinting] = useState(false);
  const [printedItemIds, setPrintedItemIds] = useState(() => new Set());
  const printKey = printCountKey(kitchen ? "kitchen" : "bill", bill?.id);
  const printCount = readPrintCount(printKey);
  const dateText = fmtDate(bill?.timestamp || new Date().toISOString());
  const kitchenBill = bill ? {
    ...bill,
    items_json: (bill.items_json || []).filter((item) => !item.is_printed),
  } : null;
  const lines = bill ? (kitchen
    ? buildKitchenTicketLines({ bill: kitchenBill, tableName, dateText, itemName })
    : buildOpenBillLines({ bill, tableName, printCount, dateText, currency: rp, itemName })) : [];
  const profileLines = [
    ...wrapPrintText(profile.app_name || "Kedai POS"),
    ...(profile.address ? wrapPrintText(profile.address) : []),
    ...(profile.phone ? wrapPrintText(`Telp. ${profile.phone}`) : []),
  ];

  useEffect(() => {
    setPrintedItemIds(new Set());
  }, [bill?.id]);

  const handlePrint = async (reprint = false) => {
    setPrinting(true);
    try {
      if (kitchen) {
        const unprintedItems = (bill.items_json || []).filter(
          (item) => !item.is_printed && !printedItemIds.has(item.id),
        );
        const printedItems = (bill.items_json || []).filter(
          (item) => item.is_printed || printedItemIds.has(item.id),
        );
        const itemsToPrint = reprint ? printedItems : unprintedItems;
        if (!itemsToPrint.length) {
          toast.info(reprint
            ? "Belum ada item tercetak untuk dicetak ulang."
            : "Semua item bill ini sudah pernah dicetak ke dapur.");
          return;
        }
        const itemIds = itemsToPrint.map((item) => item.id);
        if (!reprint && itemIds.some((id) => typeof id !== "string" || !id)) {
          throw new Error("ID item belum tersedia. Simpan ulang bill sebelum mencetak pesanan dapur.");
        }
        if (!reprint && !supabase) {
          throw new Error("Supabase belum dikonfigurasi untuk menyimpan status cetak dapur.");
        }
        await printBluetoothReceipt("kitchen", {
          id: bill.id,
          isAddOn: (bill.items_json || []).some((item) => item.is_printed),
          isDuplicate: reprint,
          tableName: tableName || bill.type || "-",
          orderTime: dateText,
          time: dateText,
          queueNumber: bill.queueNumber == null ? null : String(bill.queueNumber),
          waiter: bill.waiterName || bill.userName || "-",
          customerName: bill.customerName,
          items: itemsToPrint.map((item) => ({
            ...item,
            name: itemName(item),
            note: item.notes || item.note,
          })),
        });
        if (reprint) {
          incrementPrintCount(printKey);
          return;
        }
        setPrintedItemIds((printedIds) => new Set([...printedIds, ...itemIds]));
        const count = incrementPrintCount(printKey);
        flushSync(() => setPrintRevision(count));
        const { error } = await supabase.rpc("mark_json_items_as_printed", {
          p_bill_id: bill.id,
          p_item_ids: itemIds,
        });
        if (error) {
          throw new Error(`Pesanan sudah tercetak, tetapi status cetak gagal disimpan: ${error.message}`);
        }
      } else {
        await printBluetoothReceipt("bill", {
          id: bill.id,
          isDuplicate: printCount > 0 || Number(bill.print_count) > 0,
          tableName: tableName || bill.type || "-",
          time: dateText,
          waiter: bill.waiterName || bill.userName || "-",
          customerName: bill.customerName,
          items: (bill.items_json || []).map((item) => ({
            ...item,
            name: itemName(item),
          })),
          total: bill.total,
        });
        const count = incrementPrintCount(printKey);
        flushSync(() => setPrintRevision(count));
      }
    } catch (error) {
      toast.error(error?.message || "Struk gagal dicetak melalui Bluetooth.");
    } finally {
      setPrinting(false);
    }
  };

  return (
    <Dialog open={!!bill && !!mode} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid={`print-${mode}-dialog`} className="max-h-[90vh] overflow-y-auto sm:max-w-sm">
        <DialogHeader><DialogTitle>{kitchen ? "Cetak Dapur" : "Cetak Bill"}</DialogTitle></DialogHeader>
        {bill && (
          <div className="print-area thermal-print-area space-y-3 text-sm">
            {!kitchen && (
              <div className="flex flex-col items-center text-center">
                <BrandLogo url={profile.logo_url} className="h-12 w-12" iconClass="h-6 w-6" testid="print-bill-header-logo" />
                <pre data-testid="print-bill-header" className="thermal-lines mt-1 font-bold">{profileLines.join("\n")}</pre>
              </div>
            )}
            {!kitchen && (
              <p data-testid="print-bill-total" className="sr-only">{rp(bill.total)}</p>
            )}
            <pre
              data-testid={kitchen ? "print-kitchen-title" : "print-bill-template"}
              className={`thermal-lines ${kitchen ? "text-center font-bold" : ""}`}
            >{lines.join("\n")}</pre>
            <button
              data-testid={`print-${mode}-button`}
              type="button"
              onClick={() => handlePrint()}
              disabled={printing}
              className="no-print flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary font-medium text-primary-foreground"
            >
              <Printer className="h-4 w-4" /> {printing ? "Mencetak..." : "Cetak"}
            </button>
            {kitchen && (bill.items_json || []).some((item) => item.is_printed || printedItemIds.has(item.id)) && (
              <button
                data-testid="print-kitchen-reprint-button"
                type="button"
                onClick={() => handlePrint(true)}
                disabled={printing}
                className="no-print flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border font-medium"
              >
                <Printer className="h-4 w-4" /> Cetak Ulang Item Tercetak
              </button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
