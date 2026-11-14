import { groupOrderItemsForDisplay } from "./openBillDisplay";

// Regresi: atribusi pelayan per batch order harus terlihat di tampilan.
// Item batch lama (Pelayan 1) dan batch tambahan (Pelayan 2) tidak boleh
// digabung menjadi satu baris, supaya identitas pelayan per batch tetap jelas.
describe("groupOrderItemsForDisplay dengan pelayan per item", () => {
  it("memisahkan baris berdasarkan pelayan item", () => {
    const items = [
      {
        productId: "menu-1",
        productName: "Kopi Susu",
        qty: 1,
        price: 15000,
        subtotal: 15000,
        waiterId: "w-1",
        waiterName: "Pelayan Satu",
      },
      {
        productId: "menu-1",
        productName: "Kopi Susu",
        qty: 1,
        price: 15000,
        subtotal: 15000,
        waiterId: "w-2",
        waiterName: "Pelayan Dua",
      },
    ];

    const result = groupOrderItemsForDisplay(items);

    expect(result).toHaveLength(2);
    expect(result.map((row) => row.waiterName)).toEqual(["Pelayan Satu", "Pelayan Dua"]);
  });

  it("tetap menggabungkan baris dengan pelayan yang sama", () => {
    const items = [
      {
        productId: "menu-1",
        productName: "Kopi Susu",
        qty: 2,
        price: 15000,
        subtotal: 30000,
        waiterId: "w-1",
        waiterName: "Pelayan Satu",
      },
      {
        productId: "menu-1",
        productName: "Kopi Susu",
        qty: 1,
        price: 15000,
        subtotal: 15000,
        waiterId: "w-1",
        waiterName: "Pelayan Satu",
      },
    ];

    const result = groupOrderItemsForDisplay(items);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ qty: 3, subtotal: 45000, waiterName: "Pelayan Satu" });
  });
});
