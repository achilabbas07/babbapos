import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { ArrowLeft, Lock, UserRound } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useProfile } from "@/context/ProfileContext";
import { BrandLogo } from "@/components/BrandLogo";
import { api, errMsg, ROLE_LABEL } from "@/lib/api";
import { Button } from "@/components/ui/button";

const ROLE_TONE = {
  admin: "bg-blue-100 text-blue-700",
  kasir: "bg-emerald-100 text-emerald-700",
  waiter: "bg-amber-100 text-amber-700",
};

const quotes = [
  "Secangkir kopi yang baik berawal dari NIAT yang BAIK. Selamat bertugas!",
  "Senyum ANDA adalah awal dari rasa kopi yang nikmat.",
  "Jaga kebersihan warkop, jaga kualitas rasa. Mari berikan yang terbaik hari ini.",
  "Setiap pesanan adalah KEPERCAYAAN pelanggan. Ayo layani dengan SEPENUH HATI.",
  "Kerja tim yang SOLID pelayan dan dapur menghasilkan harmoni di meja pelanggan.",
  "Tetap FOKUS, tetap tenang. Shift yang sibuk adalah tanda bisnis kita bertumbuh.",
  "KONSISTENSI rasa adalah KUNCI. Mari seduh setiap gelas dengan standar terbaik Warkop Babba.",
  "Pelayanan CEPAT, meja BERSIH, dan sapaan RAMAH membuat pelanggan selalu ingin kembali.",
  "Keberhasilan shift hari ini ditentukan oleh komunikasi yang tanggap antar tim. Semangat!",
  "Setiap masalah di lapangan adalah pelajaran. Tetap solid, saling bantu, dan berikan solusi."
];

export default function Login() {
  const { user, login } = useAuth();
  const { profile, appName } = useProfile();
  const [dailyQuote, setDailyQuote] = useState("");
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState("");
  const [selected, setSelected] = useState(null);
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersError("");
    try {
      const { data } = await api.get("/auth/users");
      if (!Array.isArray(data)) {
        throw new Error("Respons daftar pengguna tidak valid.");
      }
      setUsers(data);
    } catch (loadError) {
      setUsersError(errMsg(loadError));
    } finally {
      setUsersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user === false) loadUsers();
  }, [user, loadUsers]);

  useEffect(() => {
    const updateDailyQuote = () => {
      const now = new Date();
      const startOfYear = Date.UTC(now.getFullYear(), 0, 0);
      const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
      const dayOfYear = Math.floor((today - startOfYear) / (1000 * 60 * 60 * 24));
      setDailyQuote(quotes[dayOfYear % quotes.length]);

      const nextMidnight = new Date();
      nextMidnight.setHours(24, 0, 0, 0);
      timeoutId = window.setTimeout(updateDailyQuote, nextMidnight.getTime() - now.getTime());
    };
    let timeoutId;
    updateDailyQuote();
    return () => window.clearTimeout(timeoutId);
  }, []);

  const chooseUser = (candidate) => {
    setSelected(candidate);
    setPin("");
    setError("");
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    if (!selected) return;
    setLoading(true);
    setError("");
    try {
      await login(selected.id, pin);
    } catch (loginError) {
      setError(errMsg(loginError));
      setPin("");
    } finally {
      setLoading(false);
    }
  };

  if (user === null) {
    return <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Memuat...</div>;
  }
  if (user) return <Navigate to="/pos" replace />;

  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
      <div
        className="relative hidden overflow-hidden bg-slate-900 lg:block"
        style={{ backgroundImage: "url('/bg-warkop.jpg')", backgroundSize: "cover", backgroundPosition: "center" }}
      >
        {/* Simpan file bg-warkop.jpg di folder public. */}
        <div className="absolute inset-0 bg-black bg-opacity-50" />
        <div className="absolute inset-0 flex flex-col justify-between p-12 text-white fade-up">
          <h1 className="text-2xl font-bold tracking-[0.2em]">WARKOP BABBA POS</h1>
          <p className="mb-12 max-w-2xl self-center px-8 py-6 text-center text-3xl font-semibold leading-snug md:text-4xl">
            {dailyQuote}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md fade-up">
          <div className="mb-8 flex items-center gap-3">
            <BrandLogo url={profile.logo_url} className="h-11 w-11" testid="login-brand-logo" />
            <div className="min-w-0">
              <p data-testid="login-brand-name" className="truncate text-xl font-bold">{appName}</p>
              <p className="text-sm text-muted-foreground">
                {selected ? "Masukkan PIN untuk melanjutkan" : "Pilih pengguna untuk masuk"}
              </p>
            </div>
          </div>

          {selected ? (
            <form onSubmit={onSubmit} className="space-y-4" data-testid="login-form">
              <button
                type="button"
                data-testid="login-back-button"
                onClick={() => chooseUser(null)}
                className="mb-2 flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm"
              >
                <ArrowLeft className="h-4 w-4" />
                <UserRound className="h-4 w-4 text-primary" />
                <span className="font-semibold">{selected.name}</span>
                <span className="text-xs text-muted-foreground">· ganti pengguna</span>
              </button>
              <label className="block space-y-1 text-sm font-medium">
                PIN
                <input
                  data-testid="login-pin-input"
                  type="password"
                  inputMode="numeric"
                  autoComplete="current-password"
                  autoFocus
                  required
                  minLength={4}
                  maxLength={6}
                  pattern="[0-9]{4,6}"
                  value={pin}
                  onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="h-11 w-full rounded-xl border border-border bg-card px-3 outline-none focus:border-primary"
                />
              </label>
              {error && <p role="alert" data-testid="login-error" className="text-sm text-destructive">{error}</p>}
              <Button data-testid="login-submit" type="submit" className="h-11 w-full" disabled={loading}>
                <Lock className="mr-2 h-4 w-4" />
                {loading ? "Memverifikasi..." : "Masuk"}
              </Button>
            </form>
          ) : usersLoading ? (
            <p role="status" className="text-center text-sm text-muted-foreground">Memuat daftar pengguna...</p>
          ) : usersError ? (
            <div className="space-y-3">
              <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{usersError}</p>
              <Button type="button" variant="outline" className="w-full" onClick={loadUsers}>Coba lagi</Button>
            </div>
          ) : users.length ? (
            <div data-testid="login-user-list" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {users.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  data-testid={`login-user-${candidate.id}`}
                  onClick={() => chooseUser(candidate)}
                  className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-card px-3 py-5 text-center shadow-sm transition-transform hover:-translate-y-0.5 hover:border-primary active:scale-95"
                >
                  <span className="grid h-12 w-12 place-items-center rounded-full bg-secondary text-lg font-bold text-primary">
                    {candidate.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="line-clamp-1 text-sm font-semibold">{candidate.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${ROLE_TONE[candidate.role] || "bg-secondary text-secondary-foreground"}`}>
                    {ROLE_LABEL[candidate.role] || candidate.role}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p role="status" className="text-center text-sm text-muted-foreground">
              Belum ada pengguna POS. Tambahkan pengguna melalui menu Pengguna &amp; PIN.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
