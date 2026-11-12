-- Perbaikan mapping bahan pada varian "Fanta (Klng)" (menu_variants.id = 30).
--
-- Masalah: varian Fanta (Klng) milik produk PRD-025 (FANTA) memakai bahan
-- baku INV-016 = "Sprite (Bahan Baku)". Akibatnya badge "Sisa" pada modal
-- pilihan variasi menampilkan stok Sprite (3), padahal halaman Inventaris
-- menampilkan Fanta (INV-017) dengan stok 15. Resep produk PRD-025 sendiri
-- sudah benar memakai INV-017.
--
-- Perbaikan hanya menyentuh baris mapping varian tersebut di atas; alur
-- transaksi kasir, laporan, dan harga tidak berubah. Idempoten: bila baris
-- sudah benar (atau varian tidak ada), tidak ada yang diubah.

DO $$
DECLARE
    affected integer;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM menu_variants WHERE id = 30 AND product_id = 'PRD-025') THEN
        RAISE NOTICE 'Varian 30 (Fanta (Klng)) tidak ditemukan, migrasi dilewati.';
        RETURN;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM inventory WHERE id = 'INV-017') THEN
        RAISE NOTICE 'Bahan INV-017 (Fanta) tidak ditemukan, migrasi dilewati.';
        RETURN;
    END IF;

    -- Cegah duplikat: kalau INV-017 sudah terpasang untuk varian ini, cukup
    -- bersihkan baris Sprite yang salah.
    IF EXISTS (SELECT 1 FROM variant_ingredients WHERE variant_id = 30 AND inventory_id = 'INV-017') THEN
        DELETE FROM variant_ingredients WHERE variant_id = 30 AND inventory_id = 'INV-016';
    ELSE
        UPDATE variant_ingredients
           SET inventory_id = 'INV-017'
         WHERE variant_id = 30
           AND inventory_id = 'INV-016';
    END IF;

    GET DIAGNOSTICS affected = ROW_COUNT;
    RAISE NOTICE 'Varian 30: % baris mapping bahan diperbaiki (Sprite -> Fanta).', affected;
END $$;

-- Verifikasi: setiap varian Fanta harus memakai INV-017.
-- SELECT mv.id, mv.variant_name, vi.inventory_id, i.name
--   FROM menu_variants mv
--   LEFT JOIN variant_ingredients vi ON vi.variant_id = mv.id
--   LEFT JOIN inventory i ON i.id = vi.inventory_id
--  WHERE mv.id = 30;
