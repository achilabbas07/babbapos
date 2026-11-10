import { useState } from "react";
import { Bluetooth } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "@/lib/api";
import { useProfile } from "@/context/ProfileContext";
import { connectBluetoothPrinter } from "@/lib/bluetoothThermalPrinter";

export const WaiterPrinterButton = () => {
  const { profile, setProfile } = useProfile();
  const [connecting, setConnecting] = useState(false);

  const connectPrinter = async () => {
    setConnecting(true);
    try {
      const device = await connectBluetoothPrinter({ printerType: "kitchen" });
      if (!device.name) {
        throw new Error("Nama perangkat Bluetooth tidak tersedia.");
      }

      const { data } = await api.put("/app-profile/printers", { printerDapur: device.name });
      setProfile((current) => ({ ...current, ...data }));
      toast.success(`Printer dapur terhubung: ${device.name}.`);
    } catch (error) {
      toast.error(error.name === "NotFoundError" ? "Pemilihan printer dibatalkan." : errMsg(error));
    } finally {
      setConnecting(false);
    }
  };

  return (
    <button
      data-testid="waiter-connect-printer-button"
      type="button"
      onClick={connectPrinter}
      disabled={connecting}
      title={profile.printerDapur ? `Printer dapur: ${profile.printerDapur}` : "Hubungkan printer dapur"}
      className="flex h-10 items-center gap-2 rounded-xl border border-border px-3 text-sm font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
    >
      <Bluetooth className="h-4 w-4" />
      <span className="hidden sm:inline">
        {connecting ? "Menghubungkan..." : profile.printerDapur || "Printer Dapur"}
      </span>
    </button>
  );
};
