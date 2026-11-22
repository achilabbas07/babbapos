// Deteksi platform native (Capacitor) untuk penyesuaian khusus aplikasi Android.
// Dipakai HANYA untuk menambah class pada <html>, sehingga aturan CSS khusus
// Android dapat di-scope tanpa mengubah tampilan aplikasi web sama sekali.
import { Capacitor } from "@capacitor/core";

// true bila berjalan sebagai aplikasi native Android (Capacitor).
export const isNativeAndroid = () => Boolean(
  Capacitor?.isNativePlatform?.() && Capacitor?.getPlatform?.() === "android",
);

// Menambahkan class `app-native-android` pada <html> bila berjalan sebagai
// aplikasi Android. Mengembalikan true bila class ditambahkan.
export const applyNativeAndroidClass = () => {
  if (typeof document === "undefined") return false;
  const android = isNativeAndroid();
  if (android) document.documentElement.classList.add("app-native-android");
  return android;
};
