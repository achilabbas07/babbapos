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
