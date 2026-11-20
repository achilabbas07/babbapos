// Transport Web Bluetooth (browser).
//
// Implementasi ini memindahkan logika navigator.bluetooth yang sebelumnya
// berada di bluetoothThermalPrinter.js tanpa mengubah perilakunya sedikit pun:
// pairing lewat dialog pemilih perangkat, pencarian ulang lewat getDevices(),
// koneksi GATT, dan pengiriman data per chunk <= 20 byte.
import { resolveDeviceId } from "../printerSettings";

const WRITE_CHUNK_SIZE = 20;
const LONG_RECEIPT_THRESHOLD_BYTES = 512;
const WRITE_CHUNK_DELAY_MS = 5;

const UNAVAILABLE_MESSAGE = "Web Bluetooth tidak tersedia. Gunakan Chrome atau Edge melalui HTTPS.";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const bluetooth = () => globalThis.navigator?.bluetooth;

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

async function writeCharacteristic(characteristic, bytes) {
  // Dokumen panjang butuh jeda antar chunk agar buffer printer thermal tidak
  // penuh dan data terakhir (termasuk perintah cut) tidak terpotong.
  const chunkDelay = bytes.length > LONG_RECEIPT_THRESHOLD_BYTES ? WRITE_CHUNK_DELAY_MS : 0;
  for (let offset = 0; offset < bytes.length; offset += WRITE_CHUNK_SIZE) {
    const chunk = bytes.slice(offset, offset + WRITE_CHUNK_SIZE);
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
    if (chunkDelay && offset + WRITE_CHUNK_SIZE < bytes.length) await sleep(chunkDelay);
  }
}

// Putuskan koneksi GATT basi (printer idle/sleep) sebelum menyambung ulang agar
// port GATT tidak memakai state lama.
async function closeConnection(target) {
  const device = target?.raw;
  if (!device?.gatt?.connected) return;
  try {
    device.gatt.disconnect();
  } catch (error) {
    console.warn("Gagal membersihkan koneksi printer Bluetooth.", error);
  }
}

const toTarget = (device) => ({
  transport: "web",
  id: resolveDeviceId(device),
  name: device?.name || "",
  uuids: device?.uuids || [],
  raw: device,
});

export const webBluetoothTransport = {
  kind: "web",
  unavailableMessage: UNAVAILABLE_MESSAGE,

  canRequestDevice() {
    return Boolean(bluetooth()?.requestDevice);
  },

  canEnumerate() {
    return Boolean(bluetooth()?.getDevices);
  },

  isConnected(target) {
    return Boolean(target?.raw?.gatt?.connected);
  },

  // Satu-satunya jalur yang memunculkan dialog pemilihan perangkat; dipakai
  // saat pairing awal dari tombol pengaturan.
  async requestDevice({ serviceUuid }) {
    const bluetoothApi = bluetooth();
    if (!bluetoothApi?.requestDevice) throw new Error(UNAVAILABLE_MESSAGE);
    const device = await bluetoothApi.requestDevice({
      acceptAllDevices: true,
      optionalServices: [serviceUuid],
    });
    return toTarget(device);
  },

  // Cari perangkat yang identitasnya tersimpan tanpa dialog pemilihan lagi.
  async findDevice({ printerId }) {
    const bluetoothApi = bluetooth();
    if (!bluetoothApi?.getDevices) return null;
    if (!printerId) return null;
    const devices = (await bluetoothApi.getDevices()) || [];
    const device = devices.find((candidate) => resolveDeviceId(candidate) === printerId);
    return device ? toTarget(device) : null;
  },

  async connect(target, { serviceUuid, characteristicUuid }) {
    const device = target?.raw;
    if (!device?.gatt) throw new Error("Perangkat yang dipilih tidak menyediakan koneksi GATT.");
    await closeConnection(target);
    const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
    const service = await server.getPrimaryService(serviceUuid);
    const characteristic = await findWritableCharacteristic(service, characteristicUuid);
    return { target, characteristic };
  },

  async write(connection, bytes) {
    await writeCharacteristic(connection.characteristic, bytes);
  },

  async resetConnection(target) {
    await closeConnection(target);
  },

  async disconnect(target) {
    const device = target?.raw;
    if (!device?.gatt) return;
    try {
      device.gatt.disconnect();
    } catch (error) {
      console.warn("Gagal memutuskan koneksi printer Bluetooth.", error);
    }
  },
};
