import { groupOrderItemsForDisplay } from "./openBillDisplay";
import { resolvePaidTotal } from "./splitPayment";
import { buildWaiterShiftReportBytes } from "./waiterShiftReport";

export const RPP02_SERVICE_UUID = "000018f0-0000-1000-8000-00805f9b34fb";
export const RPP02_CHARACTERISTIC_UUID = "00002af1-0000-1000-8000-00805f9b34fb";
export const RECEIPT_FOOTER = "Terima Kasih Atas Kunjungan Anda";
const LINE_WIDTH = 32;
const BLE_WRITE_CHUNK_SIZE = 20;
let cachedDevice = null;

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
  if (type === "waiterShift") return buildWaiterShiftReportBytes(data);
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

async function findWritableCharacteristic(service, characteristicUuid) {
  if (characteristicUuid) {
    const characteristic = await service.getCharacteristic(characteristicUuid);
    if (characteristic.properties.write || characteristic.properties.writeWithoutResponse) {
      return characteristic;
    }
    throw new Error("Karakteristik printer tidak mendukung penulisan data.");
  }

  const characteristics = await service.getCharacteristics();
  const characteristic = characteristics.find(
    (candidate) => candidate.properties.writeWithoutResponse || candidate.properties.write,
  );
  if (!characteristic) throw new Error("Karakteristik tulis printer tidak ditemukan.");
  return characteristic;
}

async function writeReceipt(characteristic, bytes) {
  for (let offset = 0; offset < bytes.length; offset += BLE_WRITE_CHUNK_SIZE) {
    const chunk = bytes.slice(offset, offset + BLE_WRITE_CHUNK_SIZE);
    if (characteristic.properties.writeWithoutResponse) {
      if (!characteristic.writeValueWithoutResponse) {
        throw new Error("Browser tidak mendukung pengiriman tanpa respons ke printer ini.");
      }
      await characteristic.writeValueWithoutResponse(chunk);
    } else if (characteristic.properties.write && characteristic.writeValueWithResponse) {
      await characteristic.writeValueWithResponse(chunk);
    } else if (characteristic.properties.write && characteristic.writeValue) {
      await characteristic.writeValue(chunk);
    } else {
      throw new Error("Browser tidak mendukung pengiriman data ke printer ini.");
    }
  }
}

async function connectDevice(device, serviceUuid, characteristicUuid) {
  if (!device?.gatt) throw new Error("Perangkat yang dipilih tidak menyediakan koneksi GATT.");
  const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
  const service = await server.getPrimaryService(serviceUuid);
  const characteristic = await findWritableCharacteristic(service, characteristicUuid);
  return { device, characteristic };
}

export async function connectBluetoothPrinter({
  serviceUuid = RPP02_SERVICE_UUID,
  characteristicUuid = RPP02_CHARACTERISTIC_UUID,
} = {}) {
  const devicePromise = selectBluetoothPrinter(serviceUuid);
  const connectionPromise = devicePromise.then((device) =>
    connectDevice(device, serviceUuid, characteristicUuid),
  );
  const { device } = await connectionPromise;
  return device;
}

export async function printBluetoothReceipt(
  type,
  data,
  {
    device: selectedDevice,
    requireConnectedDevice = false,
    serviceUuid = RPP02_SERVICE_UUID,
    characteristicUuid = RPP02_CHARACTERISTIC_UUID,
  } = {},
) {
  const bluetooth = globalThis.navigator?.bluetooth;
  if (!bluetooth?.requestDevice) {
    throw new Error("Web Bluetooth tidak tersedia. Gunakan Chrome atau Edge melalui HTTPS.");
  }

  if (requireConnectedDevice && !selectedDevice && !cachedDevice) {
    throw new Error("Printer Bluetooth belum terhubung. Hubungkan printer lalu coba cetak ulang.");
  }
  const devicePromise = selectedDevice
    ? Promise.resolve(selectedDevice)
    : requireConnectedDevice
      ? Promise.resolve(cachedDevice)
      : selectBluetoothPrinter(serviceUuid);
  const connectionPromise = devicePromise.then((device) => {
    if (requireConnectedDevice && !device?.gatt?.connected) {
      throw new Error("Printer Bluetooth terputus. Hubungkan kembali printer lalu coba cetak ulang.");
    }
    cachedDevice = device;
    return connectDevice(device, serviceUuid, characteristicUuid);
  });
  const bytes = await buildEscPosReceipt(type, data);
  const { characteristic } = await connectionPromise;
  await writeReceipt(characteristic, bytes);
}

export async function selectBluetoothPrinter(serviceUuid = RPP02_SERVICE_UUID) {
  const bluetooth = globalThis.navigator?.bluetooth;
  if (!bluetooth?.requestDevice) {
    throw new Error("Web Bluetooth tidak tersedia. Gunakan Chrome atau Edge melalui HTTPS.");
  }
  if (cachedDevice) return cachedDevice;

  cachedDevice = await bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: [serviceUuid],
  });
  return cachedDevice;
}
