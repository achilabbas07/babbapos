import { useEffect, useState } from "react";
import { Bluetooth, Printer, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RPP02_SERVICE_UUID } from "@/lib/bluetoothThermalPrinter";
import {
  clearCashierPrinterId,
  clearKitchenPrinterId,
  getCashierPrinterId,
  getKitchenPrinterId,
  resolveDeviceId,
  setCashierPrinterId,
  setKitchenPrinterId,
} from "@/lib/printerSettings";

// Murni pendaftaran identitas printer ke localStorage (Tahap 1). Tidak
// menyentuh alur cetak struk kasir maupun tiket dapur yang sudah berjalan.
const requestBluetoothDevice = async () => {
  const bluetooth = globalThis.navigator?.bluetooth;
  if (!bluetooth?.requestDevice) {
    throw new Error("Web Bluetooth tidak tersedia. Gunakan Chrome atau Edge melalui HTTPS.");
  }
  return bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: [RPP02_SERVICE_UUID],
  });
};

const SLOTS = [
  {
    kind: "kitchen",
    label: "Printer Dapur",
    buttonLabel: "Set Printer Dapur",
    testid: "printer-kitchen",
    get: getKitchenPrinterId,
    set: setKitchenPrinterId,
    clear: clearKitchenPrinterId,
  },
  {
    kind: "cashier",
    label: "Printer Kasir",
    buttonLabel: "Set Printer Kasir",
    testid: "printer-cashier",
    get: getCashierPrinterId,
    set: setCashierPrinterId,
    clear: clearCashierPrinterId,
  },
];

const PrinterSlot = ({ slot, value, connecting, onConnect, onClear }) => (
  <div className="grid gap-3 rounded-xl border border-border p-4">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Printer className="h-4 w-4" />
          {slot.label}
        </p>
        <p data-testid={`${slot.testid}-status`} className="mt-1 truncate font-mono text-xs text-muted-foreground">
          {value ? `Terdaftar: ${value}` : "Belum diatur"}
        </p>
      </div>
      {value && (
        <button
          data-testid={`${slot.testid}-clear`}
          type="button"
          onClick={onClear}
          title={`Hapus ${slot.label}`}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-destructive hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
    <Button
      data-testid={`${slot.testid}-set`}
      type="button"
      variant="outline"
      onClick={onConnect}
      disabled={connecting}
    >
      <Bluetooth className="mr-1 h-4 w-4" />
      {connecting ? "Memilih..." : slot.buttonLabel}
    </Button>
  </div>
);

export const PrinterMappingDialog = ({ open, onClose }) => {
  const [values, setValues] = useState({ kitchen: "", cashier: "" });
  const [connecting, setConnecting] = useState("");

  useEffect(() => {
    if (open) {
      setValues({ kitchen: getKitchenPrinterId(), cashier: getCashierPrinterId() });
      setConnecting("");
    }
  }, [open]);

  const connect = async (slot) => {
    setConnecting(slot.kind);
    try {
      const device = await requestBluetoothDevice();
      const deviceId = resolveDeviceId(device);
      if (!deviceId) {
        toast.error(`ID perangkat ${slot.label} tidak tersedia.`);
        return;
      }
      slot.set(deviceId);
      setValues((current) => ({ ...current, [slot.kind]: deviceId }));
      toast.success(`${slot.label} disimpan: ${deviceId}`);
    } catch (error) {
      toast.error(
        error?.name === "NotFoundError"
          ? "Pemilihan perangkat dibatalkan."
          : error?.message || `Gagal memilih ${slot.label}.`,
      );
    } finally {
      setConnecting("");
    }
  };

  const clear = (slot) => {
    slot.clear();
    setValues((current) => ({ ...current, [slot.kind]: "" }));
    toast.success(`${slot.label} dihapus.`);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="printer-mapping-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pengaturan Printer</DialogTitle>
          <DialogDescription>
            Daftarkan printer Bluetooth untuk Dapur dan Kasir. ID perangkat disimpan di perangkat ini.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {SLOTS.map((slot) => (
            <PrinterSlot
              key={slot.kind}
              slot={slot}
              value={values[slot.kind]}
              connecting={connecting === slot.kind}
              onConnect={() => connect(slot)}
              onClear={() => clear(slot)}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};
