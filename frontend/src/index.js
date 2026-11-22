import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/index.css";
import App from "@/App";
import * as serviceWorkerRegistration from "@/serviceWorkerRegistration";
import { applyNativeAndroidClass } from "@/lib/nativePlatform";

// Tandai <html> sebagai aplikasi Android (Capacitor) agar CSS khusus Android
// dapat di-scope lewat `.app-native-android` tanpa memengaruhi tampilan web.
applyNativeAndroidClass();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);

serviceWorkerRegistration.register();
