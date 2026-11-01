import axios from "axios";

const backendUrl = process.env.REACT_APP_BACKEND_URL?.trim().replace(/\/+$/, "");
const LOCAL_HOSTNAMES = ["localhost", "127.0.0.1", "::1", "[::1]"];
const isLocalHostname = (hostname) => LOCAL_HOSTNAMES.includes(hostname.toLowerCase());
const isLocalBackendUrl = (url) => /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(url);

export const getBackendConfigError = (url, frontendHostname) => {
  if (!url) {
    return "Backend belum dikonfigurasi. Isi REACT_APP_BACKEND_URL di frontend/.env atau environment hosting, lalu jalankan ulang aplikasi.";
  }
  if (frontendHostname && !isLocalHostname(frontendHostname) && isLocalBackendUrl(url)) {
    return "Backend produksi masih diarahkan ke localhost. Atur REACT_APP_BACKEND_URL ke origin backend produksi di environment hosting, lalu deploy ulang.";
  }
  return "";
};

const frontendHostname = typeof window === "undefined" ? "" : window.location.hostname;
export const backendConfigError = getBackendConfigError(backendUrl, frontendHostname);

export const api = axios.create({
  baseURL: backendUrl ? `${backendUrl}/api` : "",
});

api.interceptors.request.use((cfg) => {
  if (backendConfigError) return Promise.reject(new Error(backendConfigError));
  const token = localStorage.getItem("pos_token");
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    const url = err.config?.url || "";
    const isPinCheck = url.includes("/auth/login") || url.endsWith("/login") || url.includes("/auth/verify-admin") || url.endsWith("/void");
    if (err.response?.status === 401 && !isPinCheck) {
      localStorage.removeItem("pos_token");
      window.dispatchEvent(new Event("pos-logout"));
    }
    return Promise.reject(err);
  }
);

export function errMsg(e) {
  const data = e?.response?.data;
  const detail = data?.error ?? data?.detail;
  const stage = typeof data?.stage === "string" ? ` (${data.stage})` : "";
  if (detail == null) {
    if (e?.message === "Network Error") {
      return "Tidak dapat terhubung ke server POS. Periksa koneksi internet dan coba lagi.";
    }
    return e?.message || "Terjadi kesalahan. Silakan coba lagi.";
  }
  if (typeof detail === "string") return `${detail}${stage}`;
  if (Array.isArray(detail)) return `${detail.map((d) => (d && typeof d.msg === "string" ? d.msg : JSON.stringify(d))).join(" ")}${stage}`;
  if (typeof detail.msg === "string") return `${detail.msg}${stage}`;
  return `${String(detail)}${stage}`;
}

const rpFmt = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const numFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });
export const rp = (v) => rpFmt.format(v || 0);
export const num = (v) => numFmt.format(v || 0);
export const itemName = (i) => i.variantName || i.productName;
export const itemKey = (i) => `${i.productId}:${i.variantId ?? ""}`;
export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "-");
export const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "-");

export const toDateStr = (d) => {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const todayStr = () => toDateStr(new Date());
export const daysAgoStr = (n) => toDateStr(new Date(Date.now() - n * 86400000));
export const dayRange = (from, to) => {
  const end = new Date(`${to}T00:00:00`);
  end.setDate(end.getDate() + 1);
  return { start: new Date(`${from}T00:00:00`).toISOString(), end: end.toISOString() };
};
export const dateToIso = (d) => (d ? new Date(`${d}T12:00:00`).toISOString() : null);

export const ROLE_LABEL = { admin: "Admin", kasir: "Kasir", waiter: "Waiter" };
export const PRODUCT_TYPE_LABEL = { both: "Dine In & Takeaway", dine_in: "Dine In saja", takeaway: "Takeaway saja" };
