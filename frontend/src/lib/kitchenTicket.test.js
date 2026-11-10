import { buildKitchenPrintData, unprintedKitchenItems } from "./kitchenTicket";

describe("kitchen ticket auto-print payload", () => {
  it("filters out items that were already sent to the kitchen", () => {
    const items = [
      { id: "a", is_printed: true },
      { id: "b", is_printed: false },
      { id: "c" },
    ];
    expect(unprintedKitchenItems(items).map((item) => item.id)).toEqual(["b", "c"]);
    expect(unprintedKitchenItems(undefined)).toEqual([]);
  });

  it("builds a kitchen payload for a directly-paid transaction (no open bill)", () => {
    const trx = {
      id: "TRX-20261110-0001",
      date: "2026-11-10T02:00:00+08:00",
      type: "Walk In",
      queueNumber: 12,
      userName: "Siti",
      customerName: "Budi",
      items_json: [
        { id: "line-1", productName: "Kopi Susu", qty: 1, notes: "Less sugar", is_printed: false },
        { id: "line-2", productName: "Nasi Goreng", qty: 2, is_printed: false },
      ],
    };

    const ticket = buildKitchenPrintData(trx, { time: "10/11/2026 10:00" });

    expect(ticket).toMatchObject({
      id: "TRX-20261110-0001",
      isAddOn: false,
      isDuplicate: false,
      tableName: "Walk In",
      orderTime: "10/11/2026 10:00",
      time: "10/11/2026 10:00",
      queueNumber: "12",
      customerName: "Budi",
      waiter: "Siti",
    });
    expect(ticket.items.map((item) => item.name)).toEqual(["Kopi Susu", "Nasi Goreng"]);
    expect(ticket.items[0].note).toBe("Less sugar");
  });

  it("prefers the item variant name and flags add-on tickets", () => {
    const bill = {
      id: "BILL-001",
      type: "Dine In",
      items_json: [
        { id: "line-1", productName: "Kopi", variantName: "Kopi Susu", is_printed: true },
        { id: "line-2", productName: "Teh", is_printed: false },
      ],
    };

    const ticket = buildKitchenPrintData(bill, { isAddOn: true, tableName: "A-02" });

    expect(ticket.isAddOn).toBe(true);
    expect(ticket.tableName).toBe("A-02");
    expect(ticket.items).toHaveLength(1);
    expect(ticket.items[0].name).toBe("Teh");
  });

  it("returns null when there is nothing new to print", () => {
    expect(buildKitchenPrintData({ id: "BILL-1", items_json: [] })).toBeNull();
    expect(buildKitchenPrintData({ id: "BILL-1", items_json: [{ id: "a", is_printed: true }] })).toBeNull();
    expect(buildKitchenPrintData(null)).toBeNull();
  });
});
