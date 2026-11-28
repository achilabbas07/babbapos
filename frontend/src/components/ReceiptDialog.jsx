import { Printer } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, fmtDate, itemName, rp } from "@/lib/api";
import { printBluetoothReceipt, printerTypeForDocType } from "@/lib/bluetoothThermalPrinter";
import { useProfile } from "@/context/ProfileContext";
import { BrandLogo } from "@/components/BrandLogo";
import { buildPaidReceiptLines, incrementPrintCount, printCountKey, readPrintCount, wrapPrintText } from "@/lib/thermalPrint";

export const PrintHeader = ({ profile: override, testid }) => {
  const ctx = useProfile().profile;
  const profile = override || ctx;
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <BrandLogo url={profile.logo_url} className="h-12 w-12" iconClass="h-6 w-6" testid={`${testid}-logo`} />
      <p data-testid={`${testid}-name`} className="mt-1 font-bold">{profile.app_name || "Kedai POS"}</p>
      {profile.address && <p data-testid={`${testid}-address`} className="whitespace-pre-line text-xs text-muted-foreground">{profile.address}</p>}
      {profile.phone && <p data-testid={`${testid}-phone`} className="text-xs text-muted-foreground">Telp. {profile.phone}</p>}
    </div>
  );
};

export const PrintFooter = ({ profile: override, paid }) => {
  const ctx = useProfile().profile;
  const profile = override || ctx;
  if (!profile.additional_info && !paid) return null;
  return (
    <div data-testid="print-footer" className="space-y-1 border-t border-dashed border-border pt-3 text-center text-xs">
      {profile.additional_info && <p data-testid="print-footer-info" className="whitespace-pre-line text-muted-foreground">{profile.additional_info}</p>}
      {paid && <p data-testid="print-footer-thanks" className="font-semibold">Terima Kasih Atas Kunjungan Anda</p>}
    </div>
  );
};

const ThermalBusinessHeader = ({ testid }) => {
  const { profile } = useProfile();
  const lines = [
    ...wrapPrintText(profile.app_name || "Kedai POS"),
    ...(profile.address ? wrapPrintText(profile.address) : []),
    ...(profile.phone ? wrapPrintText(`Telp. ${profile.phone}`) : []),
  ];
  return (
    <div className="flex flex-col items-center text-center">
      <BrandLogo url={profile.logo_url} className="h-12 w-12" iconClass="h-6 w-6" testid={`${testid}-logo`} />
      <pre data-testid={testid} className="thermal-lines mt-1 font-bold">{lines.join("\n")}</pre>
    </div>
  );
};

export const ReceiptDialog = ({ trx, onClose, autoPrint = false }) => {
  const { profile } = useProfile();
  const [, setPrintRevision] = useState(0);
  const [printing, setPrinting] = useState(false);
  // Dipakai untuk "Cetak Struk Otomatis (Kasir)": cetak sekali per transaksi
  // begitu struk muncul, tanpa mengubah fungsi cetak yang sudah berjalan.
  const autoPrintedRef = useRef(null);
  // Saldo poin terbaru pelanggan (best-effort) untuk ditampilkan di struk. Bila
  // gagal diambil, bagian ini dilewati tanpa mengganggu alur pembayaran.
  const [customerPoints, setCustomerPoints] = useState(null);
  const printKey = printCountKey("receipt", trx?.id);
  const printCount = readPrintCount(printKey);
  const dateText = trx ? fmtDate(trx.orderTime || trx.createdAt || trx.date) : "";

  useEffect(() => {
    const customerId = trx?.customerId;
    if (!customerId) {
      setCustomerPoints(null);
      return undefined;
    }
    let cancelled = false;
    api.get(`/customers/${customerId}`)
      .then(({ data }) => {
        if (!cancelled) setCustomerPoints(Number(data?.points) || 0);
      })
      .catch(() => {
        if (!cancelled) setCustomerPoints(null);
      });
    return () => { cancelled = true; };
  }, [trx?.customerId]);

  const lines = trx ? buildPaidReceiptLines({
    trx,
    printCount,
    dateText,
    paidAtText: fmtDate(trx.paidAt || trx.date),
    currency: rp,
    itemName,
    customerPoints,
  }) : [];

  const handlePrint = async () => {
    setPrinting(true);
    try {
      await printBluetoothReceipt(
        "payment",
        {
          id: trx.id,
          isDuplicate: printCount > 0 || Number(trx.print_count) > 0,
          time: dateText,
          orderTime: dateText,
          paidAt: fmtDate(trx.paidAt || trx.date),
          paymentMethod: trx.method,
          payments: trx.payments,
          queueNumber: trx.queueNumber == null ? null : String(trx.queueNumber),
          waiter: trx.waiterName || trx.userName || trx.userId || "-",
          cashier: trx.userName || trx.userId || "-",
          customerName: trx.customerName,
          tableName: trx.tableName,
          items: (trx.items_json || []).map((item) => ({
            ...item,
            name: itemName(item),
          })),
          subtotal: trx.subtotal,
          total: trx.total,
          cashGiven: trx.cashGiven,
          totalPaid: trx.totalPaid,
          change: trx.change,
          promoCode: trx.promoCode,
          promoDiscount: trx.promoDiscount,
          pointsRedeemed: trx.pointsRedeemed,
          pointsDiscount: trx.pointsDiscount,
          customerId: trx.customerId,
          customerPoints,
          platform: trx.platform,
          profile: {
            nama_usaha: profile.app_name,
            alamat: profile.address,
            kota: profile.city,
            telepon: profile.phone,
            logo_url: profile.logo_url,
          },
        },
        { printerType: printerTypeForDocType("payment") },
      );
      const count = incrementPrintCount(printKey);
      flushSync(() => setPrintRevision(count));
    } catch (error) {
      toast.error(error?.message || "Struk gagal dicetak melalui Bluetooth.");
    } finally {
      setPrinting(false);
    }
  };

  // Cetak struk otomatis (bila diaktifkan di Profil Usaha). Memakai ulang
  // handlePrint yang sama dengan tombol manual, jadi alur cetak tidak berubah.
  useEffect(() => {
    if (!autoPrint || !trx?.id || printing) return;
    if (autoPrintedRef.current === trx.id) return;
    autoPrintedRef.current = trx.id;
    handlePrint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPrint, trx?.id]);

  return (
    <Dialog open={!!trx} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="receipt-dialog" className="max-h-[90dvh] overflow-y-auto sm:max-w-sm">
        <DialogHeader><DialogTitle>Struk Pembayaran</DialogTitle></DialogHeader>
        {trx && (
          <div className="print-area thermal-print-area space-y-3 text-sm">
            <ThermalBusinessHeader testid="receipt-header" />
            <pre data-testid="receipt-template" className="thermal-lines">{lines.join("\n")}</pre>
            <button
              data-testid="receipt-print-button"
              type="button"
              onClick={handlePrint}
              disabled={printing}
              className="no-print flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border font-medium hover:border-primary"
            >
              <Printer className="h-4 w-4" /> {printing ? "Mencetak..." : "Cetak Struk"}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
