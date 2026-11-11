// Helper murni untuk halaman "Laporan Sales Target" (riwayat shift pelayan).
// Dipisah dari komponen supaya logika format/normalisasi mudah diuji tanpa UI.

// Ambil daftar hasil target dari sebuah riwayat shift dengan aman.
export const shiftResults = (shift) => (Array.isArray(shift?.results) ? shift.results : []);

// Ringkasan pencapaian target untuk ditampilkan pada badge.
export const targetBadge = (result) => {
  const targetQty = Number(result?.targetQty) || 0;
  const achieved = Number(result?.achieved) || 0;
  return {
    name: result?.name || "Target",
    achieved,
    targetQty,
    done: targetQty > 0 && achieved >= targetQty,
  };
};

// Apakah shift ini sudah ditutup (punya laporan siap cetak ulang).
export const isClosedShift = (shift) => Boolean(shift?.id) && (shift?.status ? shift.status === "closed" : Boolean(shift?.closedAt));
