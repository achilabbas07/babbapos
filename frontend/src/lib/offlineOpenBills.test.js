import {
  OFFLINE_BILL_STATUS_LABEL,
  isOfflineMode,
  mergeOfflineBills,
  mergeOfflineTables,
  offlineBillActionLabel,
  offlineOrderFromBill,
  pendingOpenBillsFromQueue,
  projectOpenBills,
  projectTables,
  resolveQueueRequest,
} from "./offlineOpenBills";

const queueItem = (overrides = {}) => ({
  client_request_id: "crq-1",
  type: "open-bill-create",
  status: "pending",
  createdAt: "2024-01-01T10:00:00.000Z",
  payload: {
    type: "Dine In",
    tableId: "t1",
    customerName: "Budi",
    items: [{ id: "i1", productId: "p1", qty: 2, price: 15000, productName: "Kopi" }],
  },
  ...overrides,
});

describe("resolveQueueRequest", () => {
  it("mengirim open-bill-create sebagai POST /open-bills, mempertahankan jenis pesanan", () => {
    const item = queueItem({
      type: "open-bill-create",
      client_request_id: "crq-create",
      payload: { type: "Dine In", client_request_id: "crq-create", tableId: "t1", items: [{ productId: "p1", qty: 1 }] },
    });
    const { method, url, body } = resolveQueueRequest(item);
    expect(method).toBe("post");
    expect(url).toBe("/open-bills");
    // `type` = jenis pesanan Open Bill yang WAJIB dikirim (bukan penanda rute).
    expect(body.type).toBe("Dine In");
    expect(body).not.toHaveProperty("client_request_id");
    expect(body.tableId).toBe("t1");
  });

  it("menentukan rute dari item.type, bukan payload.type (regresi 'Field required')", () => {
    // Penanda antrean "open-bill-create" + jenis pesanan "Takeaway" harus tetap
    // diarahkan ke POST /open-bills (dulu salah jatuh ke POST /transactions
    // sehingga server membalas 422 "method: Field required").
    const item = queueItem({
      type: "open-bill-create",
      payload: { type: "Takeaway", tableId: null, items: [{ id: "i1", productId: "p1", qty: 1 }] },
    });
    const { method, url, body } = resolveQueueRequest(item);
    expect(method).toBe("post");
    expect(url).toBe("/open-bills");
    expect(body.type).toBe("Takeaway");
  });

  it("mengirim open-bill-update sebagai PUT /open-bills/{id} tanpa billId di body", () => {
    const item = queueItem({
      type: "open-bill-update",
      client_request_id: "crq-update",
      payload: { type: "Dine In", client_request_id: "crq-update", billId: "BILL-9", items: [{ productId: "p1", qty: 3 }] },
    });
    const { method, url, body } = resolveQueueRequest(item);
    expect(method).toBe("put");
    expect(url).toBe("/open-bills/BILL-9");
    expect(body).not.toHaveProperty("billId");
    expect(body.type).toBe("Dine In");
    expect(body).not.toHaveProperty("client_request_id");
  });

  it("mengirim tipe lain sebagai POST /transactions dan mempertahankan client_request_id", () => {
    const item = queueItem({
      type: "direct-payment",
      client_request_id: "crq-pay",
      payload: { method: "Cash", items: [{ productId: "p1", qty: 1 }] },
    });
    const { method, url, body } = resolveQueueRequest(item);
    expect(method).toBe("post");
    expect(url).toBe("/transactions");
    expect(body.client_request_id).toBe("crq-pay");
  });

  it("fallback ke transaksi saat open-bill-update tidak punya billId", () => {
    const item = queueItem({ type: "open-bill-update", payload: { items: [] } });
    const { method, url } = resolveQueueRequest(item);
    expect(method).toBe("post");
    expect(url).toBe("/transactions");
  });
});

describe("pendingOpenBillsFromQueue", () => {
  it("hanya memproyeksikan tipe open bill berstatus pending/failed", () => {
    const bills = pendingOpenBillsFromQueue([
      queueItem(),
      queueItem({ client_request_id: "x", status: "syncing" }),
      queueItem({ client_request_id: "y", type: "direct-payment" }),
      queueItem({ client_request_id: "z", status: "failed" }),
    ]);
    expect(bills.map((b) => b.id)).toEqual(["crq-1", "z"]);
  });

  it("mengabaikan tipe internal dan menghitung subtotal dari price*qty", () => {
    const [bill] = pendingOpenBillsFromQueue([queueItem({ payload: { type: "Dine In", items: [{ productId: "p1", qty: 2, price: 15000 }] } })]);
    expect(bill.offline).toBe(true);
    expect(bill.queuedType).toBe("open-bill-create");
    expect(bill.items_json[0].subtotal).toBe(30000);
    expect(bill.total).toBe(30000);
  });

  it("menampilkan nama menu + nominal rupiah dari payload antrean (bukan 'Menu'/'Rp 0')", () => {
    // Bentuk payload yang dikirim POS.jsx: menyertakan productName/variantName/price
    // sebagai field tampilan. Proyeksi bill offline harus memakainya agar dialog
    // detail meja menampilkan nama menu & subtotal, bukan "Menu" dan "Rp 0".
    const [bill] = pendingOpenBillsFromQueue([
      queueItem({
        payload: {
          type: "Dine In",
          items: [
            { id: "i1", productId: "p1", productName: "Kopi Susu", variantName: "Es", price: 15000, qty: 2 },
          ],
        },
      }),
    ]);
    expect(bill.items_json[0].productName).toBe("Kopi Susu");
    expect(bill.items_json[0].name).toBe("Kopi Susu");
    expect(bill.items_json[0].variantName).toBe("Es");
    expect(bill.items_json[0].price).toBe(15000);
    expect(bill.items_json[0].subtotal).toBe(30000);
    expect(bill.total).toBe(30000);
  });

  it("membaca field nama/harga bergaya snake_case dengan fallback aman", () => {
    // Payload lama/berbeda versi bisa memakai snake_case; nama & harga tetap
    // terbaca, dan subtotal dihitung dari price*qty bila `subtotal` tak ada.
    const [bill] = pendingOpenBillsFromQueue([
      queueItem({
        payload: {
          type: "Dine In",
          items: [
            { product_id: "p1", nama_menu: "Nasi Goreng", qty: 3, price: "20000" },
            { productId: "p2", qty: 1 }, // tanpa nama & tanpa harga -> fallback aman
          ],
        },
      }),
    ]);
    expect(bill.items_json[0].productName).toBe("Nasi Goreng");
    expect(bill.items_json[0].qty).toBe(3);
    expect(bill.items_json[0].subtotal).toBe(60000);
    expect(bill.items_json[1].productName).toBe("Menu");
    expect(bill.items_json[1].subtotal).toBe(0);
  });

  it("aksi update terbaru menang untuk bill yang sama", () => {
    const bills = pendingOpenBillsFromQueue([
      queueItem({ type: "open-bill-create", createdAt: "2024-01-01T10:00:00.000Z" }),
      queueItem({
        type: "open-bill-update",
        createdAt: "2024-01-01T11:00:00.000Z",
        payload: { billId: "crq-1", type: "Dine In", items: [{ productId: "p1", qty: 5, price: 15000 }] },
      }),
    ]);
    expect(bills).toHaveLength(1);
    expect(bills[0].queuedType).toBe("open-bill-update");
    expect(bills[0].total).toBe(75000);
  });

  it("memakai client_request_id sebagai id sementara saat bill belum punya id server", () => {
    const [bill] = pendingOpenBillsFromQueue([queueItem({ client_request_id: "local-1" })]);
    expect(bill.id).toBe("local-1");
    expect(bill.clientRequestId).toBe("local-1");
  });
});

describe("mergeOfflineBills", () => {
  it("menambahkan bill antrean dan menghindari duplikat id", () => {
    const cached = [{ id: "BILL-1", total: 1000 }];
    const offline = [{ id: "local-1", total: 2000 }, { id: "BILL-1", total: 1000 }];
    const merged = mergeOfflineBills(cached, offline);
    expect(merged.map((b) => b.id)).toEqual(["local-1", "BILL-1"]);
  });
});

describe("mergeOfflineTables", () => {
  it("menandai meja yang punya bill antrean sebagai occupied", () => {
    const tables = [{ id: "t1", status: "available" }, { id: "t2", status: "available" }];
    const merged = mergeOfflineTables(tables, [{ id: "local-1", tableId: "t1", total: 30000, customerName: "Budi", startTime: "2024-01-01T10:00:00.000Z" }]);
    expect(merged.find((t) => t.id === "t1").status).toBe("occupied");
    expect(merged.find((t) => t.id === "t1").orderData.openBillId).toBe("local-1");
    expect(merged.find((t) => t.id === "t2").status).toBe("available");
  });

  it("mengabaikan bill tanpa meja valid (Takeaway / 'none') tanpa error", () => {
    const tables = [{ id: "t1", status: "available" }];
    const merged = mergeOfflineTables(tables, [
      { id: "local-1", tableId: "none" },
      { id: "local-2", tableId: null },
      { id: "local-3" },
      { id: "local-4", tableId: "t-tidak-ada" },
    ]);
    expect(merged.find((t) => t.id === "t1").status).toBe("available");
  });
});

describe("projection helpers (selalu sertakan bill antrean)", () => {
  it("projectOpenBills menyatukan bill antrean tanpa duplikat id server", () => {
    const cachedD = [{ id: "BILL-1", total: 1000 }];
    const queue = [
      queueItem({ client_request_id: "local-1", payload: { type: "Dine In", items: [{ productId: "p1", qty: 1, price: 5000 }] } }),
      queueItem({ client_request_id: "BILL-1", status: "syncing" }), // sudah dikirim -> tidak diproyeksikan
    ];
    const merged = projectOpenBills(cachedD, queue);
    expect(merged.map((b) => b.id)).toEqual(["local-1", "BILL-1"]);
  });

  it("projectTables menandai meja dari bill antrean (tanpa gantung status offline)", () => {
    const tables = [{ id: "t1", status: "available" }];
    const queue = [queueItem({ payload: { type: "Dine In", tableId: "t1", items: [{ productId: "p1", qty: 1, price: 5000 }] } })];
    const merged = projectTables(tables, queue);
    expect(merged.find((t) => t.id === "t1").status).toBe("occupied");
    expect(merged.find((t) => t.id === "t1").orderData.offline).toBe(true);
  });
});

describe("helpers tampilan", () => {
  it("isOfflineMode hanya true saat navigator.onLine === false", () => {
    expect(isOfflineMode({ onLine: false })).toBe(true);
    expect(isOfflineMode({ onLine: true })).toBe(false);
    expect(isOfflineMode(undefined)).toBe(false);
  });

  it("isOfflineMode() tanpa argumen memakai sumber kebenaran tunggal (connectivity)", () => {
    // jsdom: `navigator.onLine === true` -> default online.
    expect(isOfflineMode()).toBe(false);
  });

  it("offlineOrderFromBill membentuk order POS", () => {
    const order = offlineOrderFromBill({ id: "local-1", type: "Dine In", tableId: "t1", queueNumber: 17 });
    expect(order).toEqual({ billId: "local-1", queueNumber: 17, type: "Dine In", tableId: "t1", customerId: "none", customerName: "", waiterName: "", waiterId: null });
  });

  it("label aksi & status tersedia", () => {
    expect(offlineBillActionLabel("open-bill-update")).toBe("Tambah item");
    expect(offlineBillActionLabel("open-bill-create")).toBe("Bill baru");
    expect(OFFLINE_BILL_STATUS_LABEL.pending).toBe("Menunggu dikirim");
  });
});
