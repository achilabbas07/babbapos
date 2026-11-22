function displayItemName(item) {
  return item.variantName || item.productName || item.name || item.nama_menu || item.menuName || "Menu";
}

export function groupOrderItemsForDisplay(items = []) {
  const grouped = new Map();

  for (const item of items) {
    const displayName = displayItemName(item);
    const menuKey = item.productId ?? item.id_menu ?? item.menuId ?? displayName;
    const variantKey = item.variantId ?? item.variantName ?? "";
    const notesKey = item.notes ?? item.note ?? "";
    // Pelayan per item ikut menjadi bagian kunci pengelompokan supaya menu yang
    // sama dari batch order berbeda (mis. setelah over shift) tidak tergabung
    // dan atribusi pelayan per batch tetap terbaca.
    const waiterKey = [item.waiterId ?? "", item.waiterName ?? ""];
    const key = JSON.stringify([menuKey, variantKey, displayName, notesKey, waiterKey]);
    const qty = Number(item.qty) || 0;
    const subtotal = Number(item.subtotal ?? Number(item.price || 0) * qty) || 0;
    const existing = grouped.get(key);

    if (existing) {
      existing.qty += qty;
      existing.subtotal += subtotal;
    } else {
      grouped.set(key, { ...item, displayName, qty, subtotal });
    }
  }

  return Array.from(grouped.values());
}

/**
 * Total nominal seluruh Open Bill yang sedang ditampilkan (termasuk bill
 * proyeksi offline). Memakai `total` tiap bill bila tersedia/numerik; bila
 * tidak, diturunkan dari subtotal item (atau harga satuan x qty). Murni untuk
 * ringkasan tampilan — tidak mengubah data sumber maupun kalkulasi harga/HPP.
 *
 * @param {Array<object>} bills daftar open bill (mis. `displayBills`)
 * @returns {number} total nominal (0 bila daftar kosong/tidak valid)
 */
export function openBillsGrandTotal(bills = []) {
  if (!Array.isArray(bills)) return 0;
  return bills.reduce((sum, bill) => {
    if (!bill || typeof bill !== "object") return sum;
    const total = Number(bill.total);
    if (Number.isFinite(total)) return sum + total;
    const items = Array.isArray(bill.items_json) ? bill.items_json : [];
    const fallback = items.reduce((s, item) => {
      const qty = Number(item?.qty) || 0;
      const subtotal = Number(item?.subtotal);
      if (Number.isFinite(subtotal)) return s + subtotal;
      const price = Number(item?.price);
      return s + (Number.isFinite(price) ? price * qty : 0);
    }, 0);
    return sum + fallback;
  }, 0);
}
