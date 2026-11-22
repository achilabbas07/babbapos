import { createContext, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { SESSION_USER_KEY, saveCache, readCacheData, clearCache } from "@/lib/localStore";

const AuthCtx = createContext(null);

// Bentuk user sesi yang aman di-cache lokal (tanpa token/PIN). Dipakai hanya
// sebagai fallback tampilan saat verifikasi ke server gagal KARENA JARINGAN.
const validCachedUser = (u) =>
  Boolean(u && u.id && u.role && u.name);

// HANYA 401/403 yang berarti server benar-benar MENOLAK token. Semua kegagalan
// lain (offline, timeout, 502/503 gateway, backend tidur) = gangguan sementara,
// sehingga sesi lokal yang tersimpan TIDAK boleh ikut dihapus.
const isAuthRejection = (error) => {
  const status = error?.response?.status;
  return status === 401 || status === 403;
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);

  useEffect(() => {
    let active = true;
    const token = localStorage.getItem("pos_token");
    if (!token) {
      // Token tidak ada: bersihkan sisa profil sesi lokal agar tidak salah pakai.
      clearCache(SESSION_USER_KEY);
      setUser(false);
      return undefined;
    }

    // 1) Restore optimistis dari cache lokal LEBIH DULU. Saat halaman di-refresh
    //    dalam kondisi offline, sesi langsung dipulihkan tanpa menunggu jaringan
    //    (tidak nyangkut di "Memuat..." dan tidak jatuh ke layar pilih pengguna).
    //    Profil lokal ini hanya untuk tampilan; token tetap diverifikasi ke
    //    server pada langkah 2 sehingga tidak ada hak akses backend tambahan.
    readCacheData(SESSION_USER_KEY).then((cached) => {
      if (active && validCachedUser(cached)) {
        setUser(cached);
      }
    });

    // 2) Verifikasi ke server = sumber kebenaran saat online.
    api.get("/auth/me", { timeout: 15000 })
      .then(({ data }) => {
        if (!active) return;
        setUser(data);
        // Perbarui profil sesi lokal untuk fallback offline berikutnya.
        saveCache(SESSION_USER_KEY, data);
      })
      .catch((error) => {
        if (!active) return;
        if (isAuthRejection(error)) {
          // Token benar-benar ditolak (401/403): sesi memang tidak valid.
          clearCache(SESSION_USER_KEY);
          setUser(false);
          console.error("Failed to restore POS session", error);
          return;
        }
        // Offline / timeout / server sementara: jangan tendang user. Pakai
        // profil sesi lokal bila ada agar cache Tahap 1 tetap bisa dipakai.
        // Bila tidak ada profil lokal, barulah kembali ke layar pilih pengguna.
        readCacheData(SESSION_USER_KEY).then((cached) => {
          if (!active) return;
          if (!validCachedUser(cached)) setUser(false);
        });
      });

    const onLogout = () => {
      clearCache(SESSION_USER_KEY);
      setUser(false);
    };
    window.addEventListener("pos-logout", onLogout);
    return () => {
      active = false;
      window.removeEventListener("pos-logout", onLogout);
    };
  }, []);

  const login = async (userId, pin) => {
    const { data } = await api.post("/auth/login", { userId, pin });
    if (!data.token || !data.user?.id || !data.user?.role || !data.user?.name) {
      throw new Error("Respons login tidak valid.");
    }
    localStorage.setItem("pos_token", data.token);
    saveCache(SESSION_USER_KEY, data.user); // simpan profil untuk fallback offline
    setUser(data.user);
    return data.user;
  };

  const logout = () => {
    localStorage.removeItem("pos_token");
    clearCache(SESSION_USER_KEY);
    setUser(false);
  };

  return (
    <AuthCtx.Provider value={{ user, login, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
