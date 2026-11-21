import { Capacitor } from "@capacitor/core";

const isLocalhost = Boolean(
  window.location.hostname === "localhost" ||
    window.location.hostname === "[::1]" ||
    window.location.hostname.match(
      /^127(?:\.(?:25[0-5]|2[0-4]\d|[01]?\d?\d)){3}$/,
    ),
);

// Capacitor menyajikan aset dari origin https://localhost di dalam WebView.
// Service worker di environment ini rentan menyajikan bundel lama (cache) sehingga
// layar bisa blank setelah update APK. Nonaktifkan SW di aplikasi native.
const isNativeApp = Boolean(Capacitor?.isNativePlatform?.());

async function clearStaleServiceWorkers() {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations.map((registration) => registration.unregister()),
    );
    if (typeof caches !== "undefined") {
      const cacheKeys = await caches.keys();
      await Promise.all(cacheKeys.map((key) => caches.delete(key)));
    }
  } catch (error) {
    console.warn("Gagal membersihkan service worker/cache WebView:", error);
  }
}

export function register() {
  if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) {
    return;
  }

  // Di aplikasi native (Android via Capacitor) SW dimatikan agar tidak
  // menyajikan aset lama. Bersihkan juga SW/cache yang mungkin sudah terpasang.
  if (isNativeApp) {
    void clearStaleServiceWorkers();
    return;
  }

  const publicUrl = new URL(process.env.PUBLIC_URL, window.location.href);
  if (publicUrl.origin !== window.location.origin) return;

  window.addEventListener("load", () => {
    const serviceWorkerUrl = `${process.env.PUBLIC_URL}/service-worker.js`;

    if (isLocalhost) {
      checkValidServiceWorker(serviceWorkerUrl);
    } else {
      registerValidServiceWorker(serviceWorkerUrl);
    }
  });
}

function registerValidServiceWorker(serviceWorkerUrl) {
  navigator.serviceWorker
    .register(serviceWorkerUrl)
    .then((registration) => {
      registration.onupdatefound = () => {
        const installingWorker = registration.installing;
        if (!installingWorker) return;

        installingWorker.onstatechange = () => {
          if (
            installingWorker.state === "installed" &&
            navigator.serviceWorker.controller
          ) {
            console.info("A new version is available. Reload to update.");
          }
        };
      };
    })
    .catch((error) => {
      console.error("Service worker registration failed:", error);
    });
}

function checkValidServiceWorker(serviceWorkerUrl) {
  fetch(serviceWorkerUrl, { headers: { "Service-Worker": "script" } })
    .then((response) => {
      const contentType = response.headers.get("content-type");
      if (
        response.status === 404 ||
        (contentType && !contentType.includes("javascript"))
      ) {
        return navigator.serviceWorker.ready.then((registration) =>
          registration.unregister(),
        );
      }

      return registerValidServiceWorker(serviceWorkerUrl);
    })
    .catch((error) => {
      console.error("Unable to check the service worker:", error);
    });
}
