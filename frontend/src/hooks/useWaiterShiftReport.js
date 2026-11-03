import { useCallback, useEffect, useRef, useState } from "react";
import { api, errMsg } from "@/lib/api";
import { printBluetoothReceipt } from "@/lib/bluetoothThermalPrinter";

export function useWaiterShiftReport(shiftId) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState("");
  const [printed, setPrinted] = useState(false);
  const lastAutoPrintId = useRef(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!shiftId) {
      setReport(null);
      setLoading(false);
      setFetchError("");
      setPrintError("");
      setPrinted(false);
      return undefined;
    }

    const controller = new AbortController();
    setReport(null);
    setLoading(true);
    setFetchError("");
    setPrintError("");
    setPrinted(false);

    api.get(`/waiter-shifts/${encodeURIComponent(shiftId)}`, { signal: controller.signal })
      .then(({ data }) => {
        if (data.id !== shiftId || !data.results || typeof data.results !== "object") {
          throw new Error("Data laporan shift yang diterima tidak sesuai.");
        }
        setReport(data);
      })
      .catch((error) => {
        if (error.name !== "CanceledError") setFetchError(errMsg(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [reloadKey, shiftId]);

  const printReport = useCallback(async (data = report) => {
    if (!data) return;
    setPrinting(true);
    setPrintError("");
    setPrinted(false);
    try {
      await printBluetoothReceipt("waiterShift", data, { requireConnectedDevice: true });
      setPrinted(true);
    } catch (error) {
      setPrintError(error?.message || "Laporan shift gagal dicetak melalui Bluetooth.");
    } finally {
      setPrinting(false);
    }
  }, [report]);

  useEffect(() => {
    if (!shiftId || !report || report.id !== shiftId || lastAutoPrintId.current === shiftId) return;
    lastAutoPrintId.current = shiftId;
    printReport(report);
  }, [printReport, report, shiftId]);

  return {
    report,
    loading,
    fetchError,
    printing,
    printError,
    printed,
    retryLoad: () => setReloadKey((key) => key + 1),
    retryPrint: () => printReport(),
  };
}
