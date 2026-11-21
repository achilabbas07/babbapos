import { groupOrderItemsForDisplay } from "./openBillDisplay";
import { printerTransport } from "./printerTransport";
import { resolvePaidTotal } from "./splitPayment";
import { buildWaiterShiftReportBytes } from "./waiterShiftReport";
import { getPrinterId, setPrinterId } from "./printerSettings";

export const RPP02_SERVICE_UUID = "000018f0-0000-1000-8000-00805f9b34fb";
export const RPP02_CHARACTERISTIC_UUID = "00002af1-0000-1000-8000-00805f9b34fb";
export const RECEIPT_FOOTER = "Terima Kasih Atas Kunjungan Anda";
// Jeda singkat antar dokumen agar tablet Bluetooth tidak error saat berganti koneksi.
const BLE_PRINTER_GAP_MS = 300;
// Ketahanan koneksi Bluetooth: bila printer sempat idle/mode sleep lalu GATT
// gagal tersambung atau terputus saat tombol cetak ditekan, percobaan cetak
// diulang beberapa kali dengan jeda singkat sebelum error dilempar ke pengguna.
const BLE_PRINT_RETRY_LIMIT = 3;
const BLE_PRINT_RETRY_DELAY_MS = 500;
// Web Bluetooth bisa menggantung tanpa pernah resolve/reject (mis. koneksi
// terputus di tengah pengiriman data). Batas waktu keras ini memastikan setiap
// percobaan cetak SELALU selesai sehingga promise cetak tidak pernah
// menggantung selamanya dan tombol "Mencetak..." tidak tersangkut permanen.
const BLE_PRINT_ATTEMPT_TIMEOUT_MS = 8000;
const LINE_WIDTH = 32;
let printTail = Promise.resolve();
let queuedPrints = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Balapan sebuah promise terhadap batas waktu. Bila operasi Bluetooth
// menggantung, janji ini menolak dengan pesan yang jelas sehingga pemanggil
// (dan tombol cetak) tidak menunggu tanpa akhir. Timer selalu dibersihkan agar
// tidak ada handle menggantung meski operasi selesai lebih cepat.
function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Anggaran waktu satu job cetak: 1x pencarian perangkat + Nx percobaan kirim,
// ditambah jeda antar percobaan, jeda antar dokumen, dan sedikit kelonggaran.
function printJobBudgetMs(options = {}) {
  return (options.attemptTimeoutMs || BLE_PRINT_ATTEMPT_TIMEOUT_MS) * (BLE_PRINT_RETRY_LIMIT + 1)
    + BLE_PRINT_RETRY_DELAY_MS * BLE_PRINT_RETRY_LIMIT
    + BLE_PRINTER_GAP_MS
    + 5000;
}

function encodeText(value) {
  const encoded = encodeURIComponent(value);
  const bytes = [];
  for (let index = 0; index < encoded.length; index += 1) {
    if (encoded[index] === "%") {
      bytes.push(Number.parseInt(encoded.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(encoded.charCodeAt(index));
    }
  }
  return bytes;
}

function wrapText(value, width = LINE_WIDTH) {
  const words = String(value ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [""];

  const lines = [];
  let line = "";
  for (const word of words) {
    if (Array.from(word).length > width) {
      if (line) lines.push(line);
      line = "";
      const characters = Array.from(word);
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

export function wordWrapCenter(text) {
  return wrapText(text);
}

export function formatLine(leftText, rightText, width = LINE_WIDTH) {
  return printJustify(leftText, rightText, width);
}

export function printJustify(leftText, rightText, width = LINE_WIDTH) {
  const left = Array.from(String(leftText ?? ""));
  const right = Array.from(String(rightText ?? ""));
  if (right.length >= width) return right.slice(-width).join("");
  const fittedLeft = left.slice(0, Math.max(0, width - right.length - 1)).join("");
  const spaces = width - Array.from(fittedLeft).length - right.length;
  return `${fittedLeft}${" ".repeat(spaces)}${right.join("")}`;
}

function formatItemLines(label, amount) {
  const right = String(amount ?? "");
  const leftWidth = Math.max(1, LINE_WIDTH - right.length - 1);
  return wrapText(label, leftWidth).map((text, index) =>
    index === 0 ? formatLine(text, right) : text.padEnd(LINE_WIDTH),
  );
}

function itemName(item) {
  return item.name || item.variantName || item.menuName || item.productName || "Menu";
}

function formatCurrency(value) {
  if (typeof value === "string" && value.trim()) return value.replace(/\u00a0/g, " ");
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) throw new Error("Nilai pembayaran tidak valid.");
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount).replace(/\u00a0/g, " ");
}

function fieldLine(label, value) {
  return `${label.padEnd(11)}: ${value || "-"}`;
}

function customerFieldLines(value) {
  const prefix = `${"Customer".padEnd(11)}: `;
  return wrapText(value || "-", LINE_WIDTH - prefix.length)
    .map((text, index) => ({
      type: "text",
      text: index === 0 ? `${prefix}${text}` : `${" ".repeat(prefix.length)}${text}`,
    }));
}

function itemTotal(item) {
  return Number(item.subtotal ?? Number(item.price || 0) * Number(item.qty ?? 1));
}

function paymentLines(data) {
  const items = groupOrderItemsForDisplay(data.items || data.items_json || []);
  const profile = data.profile || {};
  const paymentMethod = data.paymentMethod || data.method || "-";
  const payments = Array.isArray(data.payments)
    ? data.payments.filter((leg) => Number(leg?.amount) > 0)
    : [];
  const isSplit = payments.length > 1;
  const isCash = isSplit
    ? payments.some((leg) => leg.method === "Cash" || leg.method === "Tunai")
    : paymentMethod === "Cash" || paymentMethod === "Tunai";
  const orderTime = data.orderTime || data.createdAt || data.time || data.date;
  const waiterName = data.waiter || data.waiterName || "-";
  const cashierName = data.cashier || data.cashierName || data.userName || "-";
  const lines = [
    ...(profile.nama_usaha
      ? [{ type: "center", text: profile.nama_usaha, bold: true }]
      : []),
    ...[profile.alamat, profile.kota, profile.telepon]
      .filter(Boolean)
      .flatMap((value) => wordWrapCenter(value).map((text) => ({ type: "center", text }))),
    ...(data.isDuplicate === true
      ? [{ type: "center", text: "*** DUPLIKAT ***", bold: true }]
      : []),
    { type: "text", text: "================================" },
    { type: "text", text: fieldLine("No Nota", data.id || data.transactionNo || data.transactionId) },
    { type: "text", text: fieldLine("Waktu", orderTime) },
    { type: "text", text: fieldLine("No Urut", data.queueNumber == null ? "-" : String(data.queueNumber)) },
    { type: "text", text: fieldLine("Order", waiterName) },
    { type: "text", text: fieldLine("Kasir", cashierName) },
    { type: "text", text: fieldLine("Customer", data.customerName) },
    { type: "text", text: fieldLine("Nomor Meja", data.tableName || data.table) },
    { type: "text", text: "--------------------------------" },
  ];

  for (const item of items) {
    const qty = item.qty ?? 1;
    lines.push(...formatItemLines(
      `${qty} ${item.displayName || itemName(item)}`,
      formatCurrency(itemTotal(item)),
    ).map((text) => ({ type: "text", text })));
  }

  const itemCount = items.reduce((count, item) => count + Number(item.qty ?? 1), 0);
  const subtotal = data.subtotal ?? items.reduce((sum, item) => sum + itemTotal(item), 0);
  const total = data.total ?? subtotal;
  const cash = data.cashGiven ?? data.cash ?? 0;
  const paid = resolvePaidTotal(payments, data.totalPaid ?? data.amountPaid ?? cash);
  const cashLeg = payments.find((leg) => leg.method === "Cash" || leg.method === "Tunai");
  const changeValue = Number(data.change);
  const changeDue = Number.isFinite(changeValue)
    ? changeValue
    : cashLeg
      ? Math.max(0, (Number(data.cashGiven) || 0) - (Number(cashLeg.amount) || 0))
      : 0;

  lines.push(
    { type: "text", text: "--------------------------------" },
    { type: "text", text: formatLine(`Subtotal ${itemCount} Produk`, formatCurrency(subtotal)) },
  );
  // Informasi promo (beserta namanya) dan penukaran poin ditampilkan sebagai
  // baris pengurang tepat di atas "Total" agar nominal total mudah ditelusuri.
  const promoDiscount = Number(data.promoDiscount) || 0;
  const pointsDiscount = Number(data.pointsDiscount) || 0;
  if (promoDiscount > 0) {
    lines.push(...formatItemLines(`Promo ${data.promoCode ? data.promoCode : "Diskon"}`, `-${formatCurrency(promoDiscount)}`)
      .map((text) => ({ type: "text", text })));
  }
  if (pointsDiscount > 0) {
    const redeemed = Number(data.pointsRedeemed) || 0;
    lines.push(...formatItemLines(
      redeemed > 0 ? `Poin ditukar ${redeemed}` : "Poin ditukar",
      `-${formatCurrency(pointsDiscount)}`,
    ).map((text) => ({ type: "text", text })));
  }
  lines.push(
    { type: "text", text: formatLine("Total", formatCurrency(total)), bold: true },
    // Split: baris "Total" di atas sudah final, jadi cukup rincian metode + kembalian
    // (tanpa "Bayar Split"/"Total Bayar" yang nilainya sama persis dengan "Total").
    ...(isSplit
      ? payments.map((leg) => ({ type: "text", text: formatLine(`  ${leg.method}`, formatCurrency(leg.amount)) }))
      : [
          { type: "text", text: "--------------------------------" },
          { type: "text", text: formatLine(`Bayar ${paymentMethod}`, formatCurrency(cash)) },
          { type: "text", text: formatLine("Total Bayar", formatCurrency(paid)) },
        ]),
    ...(isCash
      ? [{ type: "text", text: formatLine("Kembalian", formatCurrency(changeDue)) }]
      : []),
  );
  // Rincian poin pelanggan: poin yang diperoleh (1 poin / Rp10.000, sesuai
  // trigger loyalitas) dan saldo poin terbaru bila datanya tersedia.
  const pointsEarned = Math.floor((Number(total) || 0) / 10000);
  if (data.customerId || data.customerName) {
    if (pointsEarned > 0) {
      lines.push({ type: "text", text: formatLine(`Poin didapat`, String(pointsEarned)) });
    }
    if (data.customerPoints != null) {
      lines.push({ type: "text", text: formatLine("Saldo poin", String(data.customerPoints)) });
    }
  }
  lines.push(
    { type: "text", text: "================================" },    
    { type: "center", text: RECEIPT_FOOTER },    
    { type: "blank", text: "" },
    { type: "center", text: `Terbayar  ${data.paidAt || data.paymentTime || data.time || data.dateTime || data.date || "-"}` },
    { type: "center", text: `dicetak: ${cashierName}` },
  );
  return lines;
}

function kitchenLines(data) {
  const items = data.items || data.items_json || [];
  const orderTime = data.orderTime || data.createdAt || data.time || data.date;
  const now = new Date();
  const printedAt = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const lines = [
    { type: "center", text: data.isAddOn === true ? "TAMBAHAN ORDER" : "DAPUR" },
    ...(data.isDuplicate === true
      ? [{ type: "center", text: "*** DUPLIKAT ***", bold: true }]
      : []),
    { type: "blank", text: "" },
    { type: "text", text: fieldLine("No Nota", data.id || data.transactionNo) },
    { type: "text", text: fieldLine("Waktu", orderTime) },
    { type: "text", text: fieldLine("No Urut", data.queueNumber == null ? "-" : String(data.queueNumber)) },
    { type: "text", text: fieldLine("Order", data.waiter) },
    { type: "text", text: fieldLine("Nomor Meja", data.tableName || data.table) },
    ...customerFieldLines(data.customerName),
    { type: "text", text: "--------------------------------" },
  ];

  for (const item of items) {
    lines.push({ type: "text", text: `${item.qty ?? 1} ${itemName(item)}` });
    if (item.note || item.notes) {
      lines.push(
        ...wrapText(item.note || item.notes, LINE_WIDTH - 2)
          .map((text) => ({ type: "text", text: `  ${text}` })),
      );
    }
  }

  lines.push(
    { type: "text", text: "================================" },
    { type: "center", text: printedAt },
    { type: "center", text: `Dicetak : ${data.waiter || "-"}` },
  );
  return lines;
}

function billLines(data) {
  const items = groupOrderItemsForDisplay(data.items || data.items_json || []);
  const lines = [
    { type: "center", text: "OPEN BILL", bold: true },
    ...(data.isDuplicate === true
      ? [{ type: "center", text: "*** DUPLIKAT ***", bold: true }]
      : []),
    { type: "text", text: fieldLine("No Bill", data.id) },
    { type: "text", text: fieldLine("Waktu", data.time || data.dateTime || data.date) },
    { type: "text", text: fieldLine("Nomor Meja", data.tableName || data.table) },
    ...customerFieldLines(data.customerName),
    { type: "text", text: "--------------------------------" },
  ];
  for (const item of items) {
    lines.push(...formatItemLines(
      `${item.qty ?? 1} ${item.displayName || itemName(item)}`,
      formatCurrency(itemTotal(item)),
    ).map((text) => ({ type: "text", text })));
  }
  lines.push(
    { type: "text", text: "--------------------------------" },
    { type: "text", text: formatLine("Total Tagihan", formatCurrency(data.total)), bold: true },
    { type: "center", text: "Belum lunas" },
  );
  return lines;
}

function shiftDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

function shiftAmount(value) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) throw new Error("Nominal laporan shift tidak valid.");
  return `Rp ${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(amount)}`;
}

function shiftRow(label, value) {
  if (Array.from(label).length + Array.from(value).length + 1 <= LINE_WIDTH) {
    return [{ type: "justify", text: printJustify(label, value) }];
  }
  return [
    ...wrapText(label).map((text) => ({ type: "justify", text })),
    { type: "justify", text: value.padStart(LINE_WIDTH) },
  ];
}

export function buildBluetoothShiftReportLines(shift, { reprint = false } = {}) {
  if (!shift || typeof shift !== "object") {
    throw new Error("Data laporan shift tidak valid.");
  }

  const totalSales = Number(shift.cashSales || 0) + Number(shift.nonCashSales || 0);
  const lines = [
    { type: "center", text: "WARKOP BABBA", bold: true },
    { type: "center", text: "Jl. Ujung No. 65, Makassar" },
    { type: "center", text: "Telp. 0853 9886 3700" },
    { type: "text", text: "=".repeat(LINE_WIDTH) },
    { type: "center", text: "LAPORAN TUTUP SHIFT", bold: true },
    ...(reprint
      ? [{ type: "justify", text: formatLine(shift.id || "-", "CETAK ULANG"), bold: true }]
      : [{ type: "center", text: shift.id || "-" }]),
    { type: "text", text: "-".repeat(LINE_WIDTH) },
    ...shiftRow("Kasir", shift.userName || "-"),
    ...shiftRow("Dibuka", shiftDate(shift.openedAt)),
    ...shiftRow("Ditutup", shiftDate(shift.closedAt)),
    ...shiftRow("Jumlah transaksi", String(shift.trxCount ?? 0)),
    { type: "text", text: "-".repeat(LINE_WIDTH) },
    ...shiftRow("Saldo awal", shiftAmount(shift.openingCash)),
    ...shiftRow("Penjualan tunai", shiftAmount(shift.cashSales)),
    ...shiftRow("Penjualan non-tunai", shiftAmount(shift.nonCashSales)),
    ...shiftRow("Total penjualan", shiftAmount(totalSales)).map((line) => ({ ...line, bold: true })),
    ...shiftRow("Kas masuk", shiftAmount(shift.cashIn)),
    ...shiftRow("Kas keluar", `- ${shiftAmount(shift.cashOut)}`),
    { type: "text", text: "-".repeat(LINE_WIDTH) },
    { type: "blank", text: "" },
    { type: "justify", text: "Saldo akhir (seharusnya)", bold: true },
    {
      type: "justify",
      text: (shift.expectedCash == null ? "-" : shiftAmount(shift.expectedCash)).padStart(LINE_WIDTH),
      bold: true,
    },
    ...shiftRow("Uang fisik", shift.countedCash == null ? "-" : shiftAmount(shift.countedCash)),
    ...shiftRow("Selisih", shift.difference == null ? "-" : shiftAmount(shift.difference)),
  ];
  return lines;
}

export function buildBluetoothReceiptLines(type, data) {
  if (!data || typeof data !== "object") {
    throw new Error("Data struk tidak valid.");
  }

  const items = data.items || data.items_json || [];
  if (!Array.isArray(items)) throw new Error("Daftar item struk tidak valid.");
  if (type === "kitchen") return kitchenLines(data);
  if (type === "payment") return paymentLines(data);
  if (type === "bill") return billLines(data);
  if (type === "shift") return buildBluetoothShiftReportLines(data, { reprint: data.isReprint === true });
  throw new Error("Jenis cetak tidak dikenal. Gunakan 'kitchen', 'payment', 'bill', atau 'shift'.");
}

function appendBytes(target, bytes) {
  for (const byte of bytes) target.push(byte);
}

export async function convertImageToESCPOS(imageUrl) {
  if (!imageUrl || typeof Image === "undefined" || typeof document === "undefined") {
    return new Uint8Array();
  }

  try {
    const image = new Image();
    image.crossOrigin = "anonymous";
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("Logo tidak dapat dimuat."));
      image.src = imageUrl;
    });

    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    if (!sourceWidth || !sourceHeight) throw new Error("Dimensi logo tidak valid.");

    const MAX_WIDTH = 200;
    const width = Math.min(MAX_WIDTH, sourceWidth);
    const height = Math.max(1, Math.round((sourceHeight * width) / sourceWidth));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas tidak tersedia untuk mengolah logo.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const pixels = context.getImageData(0, 0, width, height).data;
    const bytesPerRow = Math.ceil(width / 8);
    const raster = new Uint8Array(bytesPerRow * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixelIndex = (y * width + x) * 4;
        const grayscale = (pixels[pixelIndex] * 299 + pixels[pixelIndex + 1] * 587 + pixels[pixelIndex + 2] * 114) / 1000;
        if (grayscale < 160) {
          raster[y * bytesPerRow + Math.floor(x / 8)] |= 0x80 >> (x % 8);
        }
      }
    }

    const commandBytes = Uint8Array.from([
      0x1d, 0x76, 0x30, 0x00,
      bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff,
      height & 0xff, (height >> 8) & 0xff,
    ]);
    const imageBytes = new Uint8Array(commandBytes.length + raster.length);
    imageBytes.set(commandBytes);
    imageBytes.set(raster, commandBytes.length);
    return imageBytes;
  } catch (error) {
    console.warn("Logo struk tidak dapat dicetak; melanjutkan tanpa logo.", error);
    return new Uint8Array();
  }
}

export async function buildEscPosReceipt(type, data) {
  if (type === "waiterShift") return buildWaiterShiftReportBytes(data, { reprint: Boolean(data?.isReprint) });
  const lines = buildBluetoothReceiptLines(type, data);
  const bytes = [];
  const command = (...values) => appendBytes(bytes, values);
  const writeText = (text) => appendBytes(bytes, encodeText(text));

  command(0x1b, 0x40); // Initialize printer.
  command(0x1d, 0x4c, 0x00, 0x00);
  if (type === "payment" && data.profile?.logo_url) {
    const logoBytes = await convertImageToESCPOS(data.profile.logo_url);
    if (logoBytes.length) command(0x1b, 0x61, 0x01);
    appendBytes(bytes, logoBytes);
    if (logoBytes.length) command(0x0a, 0x1b, 0x61, 0x00);
  }

  for (const line of lines) {
    if (line.type === "blank") {
      command(0x0a);
      continue;
    }
    command(0x1b, 0x61, line.type === "center" ? 0x01 : 0x00);
    if (line.bold) command(0x1b, 0x45, 0x01);

    const textLines = line.type === "center"
      ? wordWrapCenter(line.text)
      : line.text.length <= LINE_WIDTH ? [line.text] : wrapText(line.text);
    for (const textLine of textLines) {
      writeText(textLine);
      command(0x0a);
    }

    if (line.bold) command(0x1b, 0x45, 0x00);
  }
  command(0x1b, 0x61, 0x00);
  command(0x0a, 0x0a); // Maksimal 2 baris kosong sebelum potong kertas.
  command(0x1d, 0x56, 0x00); // Full cut.
  return Uint8Array.from(bytes);
}

// Bersihkan sisa sesi sebelumnya (best-effort). Koneksi kilat membuat percobaan
// sambung ulang selalu berangkat dari kondisi bersih.
async function resetGattConnection(target) {
  await printerTransport.resetConnection(target);
}

// Ulangi satu job cetak lengkap (connect + write) selama masih ada percobaan
// tersisa. Setiap attempt membangun ulang koneksi dari nol sehingga printer
// yang baru bangun dari sleep punya kesempatan tersambung kembali.
async function runPrintAttempts(attempt, { attemptTimeoutMs = BLE_PRINT_ATTEMPT_TIMEOUT_MS } = {}) {
  let lastError;
  let target;
  for (let attemptIndex = 0; attemptIndex < BLE_PRINT_RETRY_LIMIT; attemptIndex += 1) {
    try {
      // Batasi tiap percobaan: bila koneksi/penulisan menggantung, percobaan
      // dianggap gagal dan akan dicoba ulang, bukan menunggu tanpa akhir.
      target = await withTimeout(
        Promise.resolve().then(() => attempt()),
        attemptTimeoutMs,
        "Koneksi printer Bluetooth tidak merespons (timeout).",
      );
      return;
    } catch (error) {
      lastError = error;
      if (attemptIndex < BLE_PRINT_RETRY_LIMIT - 1) {
        // Bersihkan sisa sesi gagal sebelum percobaan berikutnya.
        await resetGattConnection(target);
        await sleep(BLE_PRINT_RETRY_DELAY_MS);
      }
    }
  }
  throw lastError;
}

export async function connectBluetoothPrinter({
  serviceUuid = RPP02_SERVICE_UUID,
  characteristicUuid = RPP02_CHARACTERISTIC_UUID,
  printerType,
} = {}) {
  if (!printerTransport.canRequestDevice()) {
    throw new Error(printerTransport.unavailableMessage);
  }
  // Satu-satunya jalur yang memunculkan dialog pemilihan perangkat; dipakai
  // saat pairing awal dari tombol pengaturan.
  const target = await printerTransport.requestDevice({ serviceUuid });
  // Simpan identitas perangkat ke pemetaan printer agar cetak otomatis
  // berikutnya bisa mencari ulang perangkat tanpa dialog pemilihan lagi.
  if (printerType) setPrinterId(printerType, target.id);
  await printerTransport.connect(target, { serviceUuid, characteristicUuid });
  return { id: target.id, name: target.name, transport: target.transport };
}

// Apakah jenis printer (mis. 'kitchen' atau 'cashier') sudah dipetakan ke
// sebuah perangkat melalui Pengaturan Printer.
export function hasConfiguredPrinter(printerType) {
  if (!printerType) return false;
  try {
    return Boolean(getPrinterId(printerType));
  } catch {
    return false;
  }
}

// Cari perangkat yang identitasnya tersimpan di localStorage lewat transport
// aktif. Dipakai untuk mencetak ulang tanpa memunculkan dialog pemilihan lagi.
export async function findMappedBluetoothDevice(printerType) {
  const printerId = getPrinterId(printerType);
  if (!printerId) return null;
  return printerTransport.findDevice({ printerId });
}

async function runPrintJob(type, data, options) {
  if (!printerTransport.canEnumerate()) {
    throw new Error(printerTransport.unavailableMessage);
  }

  const printerType = options.printerType || "cashier";
  const label = printerType === "kitchen" ? "Dapur" : "Kasir";
  if (!hasConfiguredPrinter(printerType)) {
    throw new Error(`Printer ${label} belum diatur. Buka Pengaturan Printer lalu daftarkan perangkatnya.`);
  }

  // Pencarian perangkat juga dibatasi waktu: enumerasi dapat menggantung bila
  // adapter Bluetooth bermasalah, dan itu akan menyangkutkan promise cetak.
  const target = options.device || (await withTimeout(
    findMappedBluetoothDevice(printerType),
    options.deviceTimeoutMs || BLE_PRINT_ATTEMPT_TIMEOUT_MS,
    `Printer ${label} tidak merespons saat dicari (timeout).`,
  ));
  if (!target) {
    throw new Error(`Printer ${label} tidak ditemukan. Hubungkan ulang melalui Pengaturan Printer lalu coba lagi.`);
  }

  const serviceUuid = options.serviceUuid || target.uuids?.[0] || RPP02_SERVICE_UUID;
  const characteristicUuid = options.characteristicUuid || RPP02_CHARACTERISTIC_UUID;
  const wasConnected = printerTransport.isConnected(target);
  const bytes = await buildEscPosReceipt(type, data);
  try {
    // Auto-reconnect: bila printer idle/sleep dan GATT gagal atau terputus saat
    // tombol cetak ditekan, sambung ulang (koneksi bersih) sampai beberapa kali.
    await runPrintAttempts(async () => {
      const connection = await printerTransport.connect(target, { serviceUuid, characteristicUuid });
      await printerTransport.write(connection, bytes);
      return target;
    }, { attemptTimeoutMs: options.attemptTimeoutMs });
  } finally {
    // Putuskan koneksi yang dibuka job ini agar port Bluetooth tidak bentrok
    // dengan printer lain (utama saat mencetak Dapur lalu Kasir berurutan).
    try {
      if (!wasConnected && printerTransport.isConnected(target)) {
        await printerTransport.disconnect(target);
      }
    } catch (error) {
      console.warn("Gagal memutuskan koneksi printer Bluetooth.", error);
    }
  }
}

const KITCHEN_DOC_TYPES = new Set(["kitchen", "waiterShift"]);

// Tentukan printer tujuan dari jenis dokumen: tiket dapur -> printer Dapur,
// dokumen lain (bill/payment/shift kasir) -> printer Kasir. Laporan shift
// waiter ikut printer Dapur karena waiter memasangkan printer Dapur.
export function printerTypeForDocType(type) {
  return KITCHEN_DOC_TYPES.has(type) ? "kitchen" : "cashier";
}

// Semua job cetak dijalankan berurutan (sequential) dengan jeda singkat supaya
// tablet Bluetooth tidak error saat berpindah printer (mis. Dapur lalu Kasir).
export function printBluetoothReceipt(type, data, options = {}) {
  const run = () => runQueuedPrint(type, data, options);
  // Job pertama dimulai langsung agar error konfigurasi printer muncul sinkron
  // di tombol cetak; job berikutnya menunggu job sebelumnya + jeda singkat.
  const job = queuedPrints === 0 ? run() : printTail.then(run, run);
  queuedPrints += 1;
  printTail = job.then(
    () => {},
    () => {},
  ).then(() => {
    queuedPrints -= 1;
  });
  return job;
}

function runQueuedPrint(type, data, options) {
  const job = (async () => {
    // Batas waktu keseluruhan job: jaring pengaman terakhir. Sekalipun sebuah
    // operasi Bluetooth tetap menggantung, job ini menolak dengan pesan yang
    // jelas sehingga tombol cetak kembali normal dan antrean cetak berikutnya
    // tidak ikut tersangkut.
    await withTimeout(
      runPrintJob(type, data, options),
      printJobBudgetMs(options),
      "Pencetakan Bluetooth melebihi batas waktu. Periksa printer lalu coba lagi.",
    );
    await sleep(BLE_PRINTER_GAP_MS);
  })();
  // Hindari unhandled rejection; error tetap disampaikan lewat `job`.
  job.then(
    () => {},
    () => {},
  );
  return job;
}
