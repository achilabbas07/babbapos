import { groupOrderItemsForDisplay, openBillsGrandTotal } from "./openBillDisplay";

describe("groupOrderItemsForDisplay", () => {
  it("groups repeated menu items for display without changing their source data", () => {
    const items = [
      {
        id: "order-item-1",
        productId: "menu-1",
        productName: "Kopi Susu",
        qty: 2,
        price: 15000,
        subtotal: 30000,
        is_printed: true,
        notes: "",
      },
      {
        id: "order-item-2",
        productId: "menu-1",
        productName: "Kopi Susu",
        qty: 1,
        price: 15000,
        subtotal: 15000,
        is_printed: false,
        notes: "",
        addedAt: "later",
      },
      {
        id: "order-item-3",
        productId: "menu-2",
        productName: "Teh",
        qty: 1,
        price: 5000,
        subtotal: 5000,
        is_printed: false,
        notes: "",
      },
    ];
    const sourceSnapshot = JSON.stringify(items);

    const result = groupOrderItemsForDisplay(items);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ qty: 3, subtotal: 45000, is_printed: true, displayName: "Kopi Susu" });
    expect(result[1]).toMatchObject({ productId: "menu-2", qty: 1, subtotal: 5000 });
    expect(JSON.stringify(items)).toBe(sourceSnapshot);
    expect(items.map((item) => item.is_printed)).toEqual([true, false, false]);
  });

  it("keeps variants and notes as separate display rows", () => {
    const items = [
      { productId: "menu-1", productName: "Kopi", variantId: 1, variantName: "Es", qty: 1, price: 10000, notes: "" },
      { productId: "menu-1", productName: "Kopi", variantId: 2, variantName: "Panas", qty: 1, price: 9000, notes: "" },
      { productId: "menu-1", productName: "Kopi", variantId: 1, variantName: "Es", qty: 1, price: 10000, notes: "Kurang gula" },
    ];

    expect(groupOrderItemsForDisplay(items)).toHaveLength(3);
  });

  it("groups legacy items by menu ID or name and calculates missing subtotals", () => {
    const result = groupOrderItemsForDisplay([
      { id_menu: "menu-1", nama_menu: "Nasi Goreng", qty: 2, price: 20000 },
      { id_menu: "menu-1", nama_menu: "Nasi Goreng", qty: 1, price: 20000 },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ qty: 3, subtotal: 60000, displayName: "Nasi Goreng" });
  });
});

describe("openBillsGrandTotal", () => {
  it("menjumlahkan total tiap open bill yang tampil", () => {
    const bills = [
      { id: "OB-1", total: 10000 },
      { id: "OB-2", total: 21000 },
      { id: "OB-3", total: 0 },
    ];

    expect(openBillsGrandTotal(bills)).toBe(31000);
  });

  it("menurunkan total dari subtotal/harga item bila `total` tidak ada (bill proyeksi offline)", () => {
    const bills = [
      { id: "OB-offline", items_json: [{ qty: 2, subtotal: 30000 }, { qty: 1, price: 5000 }] },
      { id: "OB-online", total: 10000 },
    ];

    expect(openBillsGrandTotal(bills)).toBe(45000);
  });

  it("mengembalikan 0 untuk input kosong/tidak valid", () => {
    expect(openBillsGrandTotal()).toBe(0);
    expect(openBillsGrandTotal([])).toBe(0);
    expect(openBillsGrandTotal([null, undefined, 5])).toBe(0);
  });
});
