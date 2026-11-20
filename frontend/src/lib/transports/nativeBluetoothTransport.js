// Transport Bluetooth native (Android lewat Capacitor).
//
// Memakai plugin @capacitor-community/bluetooth-le yang di-load secara lazy
// sehingga bundle web dan lingkungan tes tidak pernah menyentuhnya. Di Android
// deviceId adalah alamat MAC printer. Chunk data tetap <= 20 byte agar identik
// dengan transport web dan aman untuk MTU terkecil.
const WRITE_CHUNK_SIZE = 20;
const LONG_RECEIPT_THRESHOLD_BYTES = 512;
const WRITE_CHUNK_DELAY_MS = 5;

const UNAVAILABLE_MESSAGE = "Bluetooth perangkat tidak tersedia. Pastikan Bluetooth aktif lalu coba lagi.";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let pluginPromise = null;
const loadPlugin = () => {
  if (!pluginPromise) {
    pluginPromise = import("@capacitor-community/bluetooth-le").catch((error) => {
      pluginPromise = null;
      throw error;
    });
  }
  return pluginPromise;
};

let initializePromise = null;
const ensureInitialized = async () => {
  const { BleClient } = await loadPlugin();
  if (!initializePromise) {
    initializePromise = BleClient.initialize({ androidNeverForLocation: true }).catch((error) => {
      initializePromise = null;
      throw error;
    });
  }
  return initializePromise;
};

// Lacak device yang koneksinya dibuka transport ini agar bisa diputuskan
// kembali setelah job cetak selesai.
const connectedIds = new Set();

const toTarget = (device) => ({
  transport: "native",
  id: String(device?.deviceId || "").trim(),
  name: device?.name || "",
  uuids: device?.uuids || [],
  raw: device,
});

async function writeBytes(connection, bytes) {
  const { BleClient, numbersToDataView } = await loadPlugin();
  const chunkDelay = bytes.length > LONG_RECEIPT_THRESHOLD_BYTES ? WRITE_CHUNK_DELAY_MS : 0;
  for (let offset = 0; offset < bytes.length; offset += WRITE_CHUNK_SIZE) {
    const chunk = bytes.slice(offset, offset + WRITE_CHUNK_SIZE);
    await BleClient.writeWithoutResponse(
      connection.deviceId,
      connection.serviceUuid,
      connection.characteristicUuid,
      numbersToDataView(Array.from(chunk)),
    );
    if (chunkDelay && offset + WRITE_CHUNK_SIZE < bytes.length) await sleep(chunkDelay);
  }
}

async function closeConnection(deviceId) {
  if (!deviceId) return;
  try {
    const { BleClient } = await loadPlugin();
    await BleClient.disconnect(deviceId);
  } catch (error) {
    console.warn("Gagal membersihkan koneksi printer Bluetooth.", error);
  } finally {
    connectedIds.delete(deviceId);
  }
}

export const nativeBluetoothTransport = {
  kind: "native",
  unavailableMessage: UNAVAILABLE_MESSAGE,

  canRequestDevice() {
    return true;
  },

  canEnumerate() {
    return true;
  },

  isConnected(target) {
    return Boolean(target?.id) && connectedIds.has(target.id);
  },

  async requestDevice({ serviceUuid }) {
    const { BleClient } = await loadPlugin();
    await ensureInitialized();
    const device = await BleClient.requestDevice({ optionalServices: [serviceUuid] });
    return toTarget(device);
  },

  async findDevice({ printerId }) {
    if (!printerId) return null;
    const { BleClient } = await loadPlugin();
    await ensureInitialized();
    const devices = (await BleClient.getDevices([printerId])) || [];
    const device = devices.find((candidate) => String(candidate?.deviceId || "").trim() === printerId);
    return device ? toTarget(device) : null;
  },

  async connect(target, { serviceUuid, characteristicUuid }) {
    const deviceId = target?.id;
    if (!deviceId) throw new Error("ID perangkat Bluetooth tidak tersedia.");
    const { BleClient } = await loadPlugin();
    await ensureInitialized();
    await closeConnection(deviceId);
    await BleClient.connect(deviceId, () => {
      connectedIds.delete(deviceId);
    });
    connectedIds.add(deviceId);
    return { target, deviceId, serviceUuid, characteristicUuid };
  },

  async write(connection, bytes) {
    await writeBytes(connection, bytes);
  },

  async resetConnection(target) {
    await closeConnection(target?.id);
  },

  async disconnect(target) {
    await closeConnection(target?.id);
  },
};
