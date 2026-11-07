export const PRINT_LINE_WIDTH = 32;

export function wrapPrintText(value, width = PRINT_LINE_WIDTH) {
  const words = String(value ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [""];

  const lines = [];
  let line = "";
  for (const word of words) {
    const characters = Array.from(word);
    if (characters.length > width) {
      if (line) {
        lines.push(line);
        line = "";
      }
      for (let index = 0; index < characters.length; index += width) {
        lines.push(characters.slice(index, index + width).join(""));
      }
    } else if (!line) {
      line = word;
    } else if (Array.from(`${line} ${word}`).length <= width) {
      line = `${line} ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function printCountKey(documentType, documentId) {
  return `babbapos:print-count:${documentType}:${documentId || "unknown"}`;
}

export function readPrintCount(key) {
  try {
    const count = Number.parseInt(window.localStorage.getItem(key) || "0", 10);
    return Number.isFinite(count) && count > 0 ? count : 0;
  } catch (error) {
    console.error("Failed to read print count", error);
    return 0;
  }
}

export function incrementPrintCount(key) {
  const count = readPrintCount(key) + 1;
  try {
    window.localStorage.setItem(key, String(count));
  } catch (error) {
    console.error("Failed to save print count", error);
  }
  return count;
}

const append = (lines, value) => lines.push(...wrapPrintText(value));
const addSeparator = (lines) => lines.push("-".repeat(PRINT_LINE_WIDTH));

export function buildPaidReceiptLines({ trx, printCount, dateText, paidAtText, currency, itemName }) {
  const lines = [];
  const waiterName = trx.waiterName || trx.userName || trx.userId || "-";
  const cashierName = trx.userName || trx.userId || "-";
  if (printCount >= 2) lines.push("DUPLIKAT");
  lines.push("STRUK PEMBAYARAN");
  addSeparator(lines);
  append(lines, `No. Pesanan: ${trx.id}`);
  append(lines, `Pelayan: ${waiterName}`);
  append(lines, `Kasir: ${cashierName}`);
  append(lines, `Tanggal: ${dateText}`);
  append(lines, `No. Urut: ${trx.queueNumber == null ? "-" : String(trx.queueNumber)}`);
  if (trx.tableName) append(lines, `Meja: ${trx.tableName}`);
  if (trx.customerName) append(lines, `Pelanggan: ${trx.customerName}`);
  addSeparator(lines);
  for (const item of trx.items_json || []) {
    append(lines, `${item.qty}x ${itemName(item)}`);
    append(lines, `  ${currency((item.price || 0) * (item.qty || 0))}`);
  }
  addSeparator(lines);
  if (trx.discount > 0) append(lines, `Subtotal: ${currency(trx.subtotal)}`);
  if (trx.promoDiscount > 0) append(lines, `Promo: -${currency(trx.promoDiscount)}`);
  if (trx.pointsDiscount > 0) append(lines, `Poin: -${currency(trx.pointsDiscount)}`);
  append(lines, `Total: ${currency(trx.total)}`);
  const payments = Array.isArray(trx.payments) ? trx.payments.filter((leg) => Number(leg?.amount) > 0) : [];
  const isSplit = payments.length > 1;
  const cashTender = payments.find((leg) => leg.method === "Cash" || leg.method === "Tunai");
  append(lines, `Bayar ${isSplit ? "Split" : trx.method || "-"}`);
  append(lines, `Bayar: ${currency(trx.cashGiven)}`);
  if (isSplit) {
    for (const leg of payments) append(lines, `• ${leg.method}: ${currency(leg.amount)}`);
  }
  if (cashTender || trx.method === "Cash" || trx.method === "Tunai") {
    append(lines, `Kembalian: ${currency(trx.change)}`);
  }
  append(lines, "Status: LUNAS");
  if (trx.tableName) append(lines, "Status Meja: LUNAS");
  addSeparator(lines);
  if (paidAtText) append(lines, `Waktu bayar: ${paidAtText}`);
  append(lines, "Terima Kasih Atas Kunjungan Anda");
  return lines;
}

export function buildOpenBillLines({ bill, tableName, printCount, dateText, currency, itemName }) {
  const lines = [];
  if (printCount >= 2) lines.push("DUPLIKAT");
  lines.push("OPEN BILL");
  addSeparator(lines);
  append(lines, `No. Bill: ${bill.id}`);
  append(lines, `Meja: ${tableName || bill.type || "-"}`);
  append(lines, `Waktu: ${dateText}`);
  append(lines, `No. Urut: ${bill.queueNumber == null ? "-" : String(bill.queueNumber)}`);
  append(lines, `Pelayan: ${bill.waiterName || bill.userName || "-"}`);
  if (bill.customerName) append(lines, `Pelanggan: ${bill.customerName}`);
  addSeparator(lines);
  for (const item of bill.items_json || []) {
    append(lines, `${item.qty}x ${itemName(item)}`);
    append(lines, `  ${currency(item.subtotal ?? (item.price || 0) * (item.qty || 0))}`);
  }
  addSeparator(lines);
  append(lines, `Total Tagihan: ${currency(bill.total)}`);
  append(lines, "Belum lunas");
  return lines;
}

export function buildKitchenTicketLines({ bill, tableName, isDuplicate = false, dateText, itemName }) {
  const lines = [];
  if (isDuplicate) lines.push("DUPLIKAT");
  lines.push("ORDER DAPUR");
  addSeparator(lines);
  append(lines, `Meja: ${tableName || bill.type || "-"}`);
  append(lines, `Waktu: ${dateText}`);
  append(lines, `No. Urut: ${bill.queueNumber == null ? "-" : String(bill.queueNumber)}`);
  append(lines, `Pelayan: ${bill.waiterName || bill.userName || "-"}`);
  append(lines, `No. Order: ${bill.id}`);
  addSeparator(lines);
  for (const item of bill.items_json || []) {
    append(lines, `${item.qty}x ${itemName(item)}`);
    if (item.notes) append(lines, `Catatan: ${item.notes}`);
  }
  return lines;
}
