import { itemName } from "./api";

// Item yang belum pernah dikirim ke printer dapur (is_printed masih false).
export const unprintedKitchenItems = (items) =>
  (Array.isArray(items) ? items : []).filter((item) => item && !item.is_printed);

// Bangun payload tiket dapur untuk printer Bluetooth dari sebuah dokumen
// (open bill atau transaksi). Dipakai agar dapur tetap menerima pesanan pada
// pembayaran langsung (tanpa open bill). Mengembalikan null bila tidak ada
// item baru untuk dicetak, sehingga pemanggil bisa melewati proses cetak.
export function buildKitchenPrintData(source, { isAddOn = false, tableName, time } = {}) {
  if (!source || typeof source !== "object") return null;
  const items = unprintedKitchenItems(source.items_json || source.items);
  if (!items.length) return null;

  const dateText = time || source.orderTime || source.timestamp || source.date;
  return {
    id: source.id,
    isAddOn,
    isDuplicate: false,
    tableName: tableName || source.tableName || source.type || "-",
    orderTime: dateText,
    time: dateText,
    queueNumber: source.queueNumber == null ? null : String(source.queueNumber),
    customerName: source.customerName,
    waiter: source.waiterName || source.userName || "-",
    items: items.map((item) => ({
      ...item,
      name: itemName(item),
      note: item.notes || item.note,
    })),
  };
}
