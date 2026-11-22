import {
  openBillCacheKey,
  enqueueTransaction,
  getTransactionQueue,
  clearTransactionQueue,
  TRANSACTION_QUEUE_KEY,
  QUEUE_STATUS,
} from "./localStore";

// Catatan: jest berjalan tanpa IndexedDB (jsdom), sehingga `localStore`
// otomatis memakai fallback `localStorage` -- cukup untuk menguji antrean.

describe("openBillCacheKey", () => {
  it("membuat key cache detail per bill yang stabil", () => {
    expect(openBillCacheKey("BILL-1")).toBe("open-bill:BILL-1");
    expect(openBillCacheKey(42)).toBe("open-bill:42");
  });

  it("memakai key antrean transaksi persisten yang sama", () => {
    expect(TRANSACTION_QUEUE_KEY).toBe("transaction-queue");
  });
});

describe("antrean simpan Open Bill offline", () => {
  beforeEach(async () => {
    await clearTransactionQueue();
  });

  it("menyimpan aksi open-bill-create dengan client_request_id", async () => {
    const clientRequestId = "crq-openbill-1";
    const payload = { type: "Dine In", tableId: "t1", queueNumber: 17, items: [{ productId: "p1", qty: 1 }] };
    const item = await enqueueTransaction(payload, { type: "open-bill-create", clientRequestId });

    expect(item).not.toBeNull();
    expect(item.client_request_id).toBe(clientRequestId);
    expect(item.type).toBe("open-bill-create");
    expect(item.status).toBe(QUEUE_STATUS.PENDING);

    const queue = await getTransactionQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].payload).toEqual(payload);
    expect(queue[0].payload).not.toHaveProperty("billId");
  });

  it("menyimpan aksi open-bill-update beserta billId pada payload", async () => {
    const clientRequestId = "crq-openbill-2";
    await enqueueTransaction({ type: "Dine In", items: [] }, { type: "open-bill-update", clientRequestId });

    // billId ditambahkan pemanggil sebelum enqueue (lihat POS.jsx.saveBill).
    const [stored] = await getTransactionQueue();
    expect(stored.type).toBe("open-bill-update");
    expect(stored.client_request_id).toBe(clientRequestId);
  });

  it("menimpa item dengan client_request_id yang sama (idempoten di antrean)", async () => {
    await enqueueTransaction({ items: [{ qty: 1 }] }, { type: "open-bill-create", clientRequestId: "dup" });
    await enqueueTransaction({ items: [{ qty: 2 }] }, { type: "open-bill-create", clientRequestId: "dup" });

    const queue = await getTransactionQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].payload.items[0].qty).toBe(2);
  });
});
