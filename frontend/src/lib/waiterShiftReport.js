import ReceiptPrinterEncoder from "@point-of-sale/receipt-printer-encoder";

const LINE_WIDTH = 32;

const fit = (value, width) => Array.from(String(value ?? "")).slice(0, width).join("");

const paddedRow = (label, value) => {
  const right = fit(value ?? "-", LINE_WIDTH - 1);
  const leftWidth = Math.max(0, LINE_WIDTH - right.length - 1);
  return `${fit(label, leftWidth).padEnd(leftWidth)}${right.padStart(LINE_WIDTH - leftWidth)}`;
};

const wrap = (value, width) => {
  const words = String(value ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines = [];
  let line = "";
  for (const word of words) {
    const characters = Array.from(word);
    if (characters.length > width) {
      if (line) lines.push(line);
      line = "";
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
};

function validateReport(shift) {
  const results = shift?.results;
  if (!shift || typeof results !== "object" || results === null) {
    throw new Error("Data laporan shift pelayan tidak valid.");
  }
  if (!Array.isArray(results.orders_data) || !Array.isArray(results.voids?.details)) {
    throw new Error("Ringkasan produk atau detail void laporan shift tidak valid.");
  }
  for (const [field, value] of [
    ["total_orders", results.total_orders],
    ["active_tables", results.active_tables],
    ["total void", results.voids.total],
  ]) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`Nilai ${field} pada laporan shift tidak valid.`);
    }
  }
  if (typeof results.target_sales_status !== "string"
    || results.orders_data.some((item) => !item || typeof item.variant_name !== "string" || typeof item.qty !== "number")
    || results.voids.details.some((item) => !item || typeof item.name !== "string" || typeof item.qty !== "number")) {
    throw new Error("Isi laporan produk, void, atau target tidak valid.");
  }
}

export function buildWaiterShiftReportLines(shift) {
  validateReport(shift);
  const results = shift.results;
  const lines = [
    { text: "LAPORAN TUTUP SHIFT", align: "center", bold: true },
    { text: "PELAYAN", align: "center", bold: true },
    { text: paddedRow("Nama", shift.waiter_name), align: "left" },
    { text: paddedRow("Tutup", shift.closed_at), align: "left" },
    { text: paddedRow("Shift", shift.shift_id), align: "left" },
    { text: "AKTIVITAS PELAYANAN", align: "left", bold: true },
    { text: paddedRow("Total pesanan", results.total_orders), align: "left" },
    { text: paddedRow("Meja aktif", results.active_tables), align: "left" },
    { text: "RINGKASAN PRODUK TERJUAL", align: "left", bold: true },
  ];

  if (results.orders_data.length) {
    results.orders_data.forEach((item) => {
      const quantity = fit(`${item.qty}x`, LINE_WIDTH - 1);
      const nameWidth = Math.max(0, LINE_WIDTH - quantity.length - 1);
      const name = fit(item.variant_name || "-", Math.min(20, nameWidth));
      lines.push({
        text: `${name.padEnd(nameWidth)} ${fit(quantity, quantity.length)}`,
        align: "left",
      });
    });
  } else {
    lines.push({ text: "Belum ada produk terjual", align: "left" });
  }

  lines.push(
    { text: "LOG AUDIT & KOREKSI", align: "left", bold: true },
    { text: paddedRow("Total void", results.voids.total), align: "left" },
  );
  if (results.voids.details.length) {
    results.voids.details.forEach((detail) => {
      const bullet = wrap(`- ${detail.name} x${detail.qty}`, LINE_WIDTH);
      bullet.forEach((text) => lines.push({ text, align: "left" }));
      wrap(`  Alasan: ${detail.reason || "-"}`, LINE_WIDTH).forEach((text) => {
        lines.push({ text, align: "left" });
      });
    });
  } else {
    lines.push({ text: "Tidak ada koreksi", align: "left" });
  }

  lines.push(
    { text: "RINGKASAN TARGET", align: "left", bold: true },
    { text: fit(results.target_sales_status || "-", LINE_WIDTH), align: "left" },
    { text: "", align: "left" },
    { text: `${"( Pelayan )".padEnd(18)}( .......... )`, align: "left" },
  );

  if (lines.some((line) => Array.from(line.text).length > LINE_WIDTH)) {
    throw new Error("Baris laporan shift melebihi lebar 32 karakter.");
  }
  return lines;
}

export function buildWaiterShiftReportBytes(shift) {
  const encoder = new ReceiptPrinterEncoder({ width: LINE_WIDTH });
  encoder.initialize();
  for (const line of buildWaiterShiftReportLines(shift)) {
    encoder.align(line.align);
    if (line.bold) encoder.bold();
    encoder.text(line.text).newline();
    if (line.bold) encoder.bold();
  }
  encoder.align("left").newline().newline().newline().cut();
  return encoder.encode();
}
