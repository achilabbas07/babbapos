// Validasi order POS: transaksi yang diproses oleh role Kasir atau Admin
// WAJIB memilih nama pelayan (tidak boleh "Tanpa pelayan" / kosong).
// Role waiter SENGAJA tidak diatur di sini agar perilakunya tetap seperti semula.
export const WAITER_REQUIRED_ROLES = ["admin", "kasir"];

// Role yang wajib memilih pelayan (Kasir/Admin). Role lain (mis. waiter) -> false.
export const roleRequiresWaiter = (role) => WAITER_REQUIRED_ROLES.includes(String(role || "").trim().toLowerCase());

// Apakah order sudah memiliki pelayan terpilih (bukan null / "" / "none").
export const hasSelectedWaiter = (order) => {
  const waiterId = order?.waiterId;
  if (waiterId == null) return false;
  const value = String(waiterId).trim();
  return value !== "" && value.toLowerCase() !== "none";
};

// Pesan peringatan bila validasi gagal, atau null bila lolos validasi.
export const waiterValidationMessage = (role, order) => (
  roleRequiresWaiter(role) && !hasSelectedWaiter(order)
    ? "Nama pelayan wajib dipilih untuk transaksi oleh Kasir/Admin."
    : null
);
