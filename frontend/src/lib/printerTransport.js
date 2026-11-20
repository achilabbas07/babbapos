// Façade transport printer Bluetooth.
//
// Memilih implementasi transport secara otomatis: Web Bluetooth saat berjalan di
// browser, dan Bluetooth native (Capacitor) saat berjalan sebagai aplikasi
// Android. Seluruh pemanggil (bluetoothThermalPrinter.js, dialog pengaturan)
// hanya berbicara dengan permukaan seragam di bawah ini sehingga alur cetak
// tidak perlu tahu sedang berjalan di web atau native.
import { Capacitor } from "@capacitor/core";
import { nativeBluetoothTransport } from "./transports/nativeBluetoothTransport";
import { webBluetoothTransport } from "./transports/webBluetoothTransport";

const isNative = () => {
  try {
    return Boolean(Capacitor?.isNativePlatform?.());
  } catch {
    return false;
  }
};

export const getPrinterTransport = () => (isNative() ? nativeBluetoothTransport : webBluetoothTransport);

export const printerTransport = {
  get kind() {
    return getPrinterTransport().kind;
  },

  get unavailableMessage() {
    return getPrinterTransport().unavailableMessage;
  },

  isNative,

  canRequestDevice() {
    return getPrinterTransport().canRequestDevice();
  },

  canEnumerate() {
    return getPrinterTransport().canEnumerate();
  },

  isConnected(target) {
    return getPrinterTransport().isConnected(target);
  },

  requestDevice(options) {
    return getPrinterTransport().requestDevice(options);
  },

  findDevice(options) {
    return getPrinterTransport().findDevice(options);
  },

  connect(target, options) {
    return getPrinterTransport().connect(target, options);
  },

  write(connection, bytes) {
    return getPrinterTransport().write(connection, bytes);
  },

  resetConnection(target) {
    return getPrinterTransport().resetConnection(target);
  },

  disconnect(target) {
    return getPrinterTransport().disconnect(target);
  },
};
