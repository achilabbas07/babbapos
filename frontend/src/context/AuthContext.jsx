import { createContext, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { SESSION_USER_KEY, saveCache, readCacheData, clearCache } from "@/lib/localStore";

const AuthCtx = createContext(null);

// Bentuk user sesi yang aman di-cache lokal (tanpa token/PIN). Dipakai hanya
// sebagai fallback tampilan saat verifikasi ke server gagal KARENA JARINGAN.
const validCachedUser = (u) =>
  Boolean(u && u.id && u.role && u.name);

// True bila error benar-benar masalah jaringan (server tak terjangkau),
// BUKAN penolakan autentikasi dari server (mis. 401/403).
const isNetworkError = (error) => {
  if (!error) return true;
  if (error.response) return false; // server menjawab -> bukan error jaringan
  return true; // "Network Error" / timeout / tanpa response
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

    api.get("/auth/me")
      .then(({ data }) => {
        if (!active) return;
        setUser(data);
        // Perbarui profil sesi lokal untuk fallback offline berikutnya.
        saveCache(SESSION_USER_KEY, data);
      })
      .catch((error) => {
        if (!active) return;
        if (isNetworkError(error)) {
          // Offline / jaringan gagal: jangan tendang user ke /login. Pakai
          // profil sesi terakhir yang tersimpan agar tetap bisa memakai cache
          // Tahap 1 (menu/meja/pelanggan). Token TIDAK diubah.
          readCacheData(SESSION_USER_KEY).then((cached) => {
            if (!active) return;
            if (validCachedUser(cached)) {
              setUser(cached);
              console.warn("POS session restored from local cache (offline).");
            } else {
              setUser(false);
            }
          });
          return;
        }
        // 401/403 (token ditolak): sesi memang tidak valid. api.js sudah
        // membersihkan token untuk 401; bersihkan profil lokal juga.
        clearCache(SESSION_USER_KEY);
        setUser(false);
        console.error("Failed to restore POS session", error);
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
