import ReceiptPrinterEncoder from "@point-of-sale/receipt-printer-encoder";

const LINE_WIDTH = 32;
const MONTHS_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

const fit = (value, width) => Array.from(String(value ?? "")).slice(0, width).join("");
const rule = (character = "-") => character.repeat(LINE_WIDTH);

const paddedRow = (label, value) => {
  const right = fit(value ?? "-", LINE_WIDTH - 1);
  const leftWidth = Math.max(0, LINE_WIDTH - right.length - 1);
  return `${fit(label, leftWidth).padEnd(leftWidth)}${right.padStart(LINE_WIDTH - leftWidth)}`;
};

const pad2 = (number) => String(number).padStart(2, "0");

// Backend stores shift timestamps in UTC (with an explicit offset). The receipt
// must show the cashier/waiter local time, so any zoned value is converted while
// legacy wall-clock strings (no offset) are printed as-is.
function formatShiftDateTime(value) {
  const raw = String(value ?? "").trim();
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) {
      return {
        date: `${pad2(date.getDate())} ${MONTHS_ID[date.getMonth()]} ${date.getFullYear()}`,
        time: `${pad2(date.getHours())}:${pad2(date.getMinutes())}`,
      };
    }
  }
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!match) return { date: fit(raw || "-", LINE_WIDTH), time: "-" };
  const [, year, month, day, hour, minute] = match;
  const monthIndex = Number(month) - 1;
  if (monthIndex < 0 || monthIndex >= MONTHS_ID.length) {
    return { date: fit(raw, LINE_WIDTH), time: "-" };
  }
  return {
    date: `${day} ${MONTHS_ID[monthIndex]} ${year}`,
    time: hour ? `${hour}:${minute}` : "-",
  };
}

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
  const closedAt = formatShiftDateTime(shift.closed_at);
  const openedAt = formatShiftDateTime(shift.opened_at);
  const openedLabel = openedAt.date === closedAt.date
    ? openedAt.time
    : `${openedAt.date} ${openedAt.time}`;
  const lines = [
    { text: "LAPORAN TUTUP", align: "center", bold: true },
    { text: "SHIFT PELAYAN", align: "center", bold: true },
    { text: rule("="), align: "center" },
    { text: paddedRow("Nama", shift.waiter_name), align: "left" },
    { text: paddedRow("Tanggal", closedAt.date), align: "left" },
    { text: paddedRow("Dibuka", openedLabel), align: "left" },
    { text: paddedRow("Ditutup", closedAt.time), align: "left" },
    { text: paddedRow("Shift", shift.shift_id), align: "left" },
    { text: rule(), align: "center" },
    { text: "AKTIVITAS PELAYANAN", align: "left", bold: true },
    { text: paddedRow("Total pesanan", results.total_orders), align: "left" },
    { text: paddedRow("Meja aktif", results.active_tables), align: "left" },
    { text: rule(), align: "center" },
    { text: "RINGKASAN PRODUK TERJUAL", align: "left", bold: true },
  ];

  if (results.orders_data.length) {
    results.orders_data.forEach((item) => {
      const quantity = fit(`${item.qty}x`, 8);
      const nameWidth = LINE_WIDTH - quantity.length - 1;
      const nameLines = wrap(item.variant_name || "-", nameWidth);
      nameLines.forEach((name, index) => {
        lines.push({
          text: `${index === 0 ? quantity : " ".repeat(quantity.length)} ${name}`,
          align: "left",
        });
      });
    });
  } else {
    lines.push({ text: "Belum ada produk terjual", align: "left" });
  }

  lines.push(
    { text: rule(), align: "center" },
    { text: rule(), align: "center" },
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
    { text: rule(), align: "center" },
    { text: rule(), align: "center" },
    { text: "RINGKASAN TARGET", align: "center", bold: true },
    { text: `+${"-".repeat(LINE_WIDTH - 2)}+`, align: "center" },
  );
  wrap(results.target_sales_status || "-", LINE_WIDTH - 4).forEach((text) => {
    lines.push({ text: `| ${text.padEnd(LINE_WIDTH - 4)} |`, align: "center", bold: true });
  });
  lines.push(
    { text: `+${"-".repeat(LINE_WIDTH - 2)}+`, align: "center" },
    { text: "", align: "left" },
    { text: `${"( Pelayan )".padEnd(18)}( Supervisor )`, align: "left" },
    { text: `${"_".repeat(13)}  ${"_".repeat(13)}`, align: "left" },
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
  // Maksimal 2 baris kosong sebelum potong kertas agar tidak membuang kertas.
  encoder.align("left").newline().newline().cut();
  return encoder.encode();
}
