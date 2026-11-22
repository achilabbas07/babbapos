import { QUEUE_STATUS } from "./localStore";
import {
  QUEUE_BADGE_POLL_MS,
  QUEUE_BADGE_STATE,
  formatQueueTime,
  queueBadgeTooltip,
  queueItemStatusLabel,
  queueItemSummary,
  summarizeTransactionQueue,
} from "./queueStatus";

const item = (overrides = {}) => ({
  client_request_id: "crq-1",
  type: "direct-payment",
  payload: null,
  status: QUEUE_STATUS.PENDING,
  retryCount: 0,
  createdAt: "2026-11-22T03:00:00.000Z",
  updatedAt: "2026-11-22T03:00:00.000Z",
  lastAttemptAt: null,
  lastError: null,
  nextAttemptAt: null,
  ...overrides,
});

describe("summarizeTransactionQueue", () => {
  it("menyembunyikan badge saat antrean kosong & tidak sync", () => {
    const s = summarizeTransactionQueue([]);
    expect(s.visible).toBe(false);
    expect(s.state).toBe(QUEUE_BADGE_STATE.IDLE);
    expect(s.total).toBe(0);
  });

  it("menampilkan jumlah antrean saat ada item pending", () => {
    const s = summarizeTransactionQueue([item(), item({ client_request_id: "crq-2" })]);
    expect(s.visible).toBe(true);
    expect(s.state).toBe(QUEUE_BADGE_STATE.PENDING);
    expect(s.pending).toBe(2);
    expect(s.label).toBe("Antrean: 2");
  });

  it("memprioritaskan status gagal dengan jumlah gagal", () => {
    const s = summarizeTransactionQueue([
      item({ status: QUEUE_STATUS.PENDING }),
      item({ client_request_id: "crq-2", status: QUEUE_STATUS.FAILED }),
      item({ client_request_id: "crq-3", status: QUEUE_STATUS.FAILED }),
    ]);
    expect(s.state).toBe(QUEUE_BADGE_STATE.FAILED);
    expect(s.failed).toBe(2);
    expect(s.label).toBe("Gagal: 2");
  });

  it("menampilkan 'Menyinkronkan...' saat item berstatus syncing", () => {
    const s = summarizeTransactionQueue([item({ status: QUEUE_STATUS.SYNCING })]);
    expect(s.state).toBe(QUEUE_BADGE_STATE.SYNCING);
    expect(s.label).toBe("Menyinkronkan...");
  });

  it("menampilkan 'Menyinkronkan...' saat bendera isQueueSyncing true", () => {
    const s = summarizeTransactionQueue([item()], { syncing: true });
    expect(s.state).toBe(QUEUE_BADGE_STATE.SYNCING);
    expect(s.label).toBe("Menyinkronkan...");
  });

  it("aman terhadap data tak terduga", () => {
    expect(summarizeTransactionQueue(null).visible).toBe(false);
    expect(summarizeTransactionQueue(undefined).visible).toBe(false);
    expect(summarizeTransactionQueue("bukan array").visible).toBe(false);
  });

  it("menganggap status tak dikenal sebagai pending", () => {
    const s = summarizeTransactionQueue([item({ status: "aneh" })]);
    expect(s.pending).toBe(1);
    expect(s.state).toBe(QUEUE_BADGE_STATE.PENDING);
  });
});

describe("queueItemSummary", () => {
  it("meringkas tipe, jumlah item, dan metode", () => {
    const info = queueItemSummary(item({
      payload: {
        type: "Walk In",
        method: "QRIS",
        items: [{ qty: 2 }, { qty: 3 }],
      },
    }));
    expect(info.count).toBe(2);
    expect(info.qty).toBe(5);
    expect(info.summary).toBe("Walk In · 5 item · QRIS");
    expect(info.amountLabel).toBe("");
  });

  it("menampilkan nominal dari rincian pembayaran bila ada", () => {
    const info = queueItemSummary(item({
      payload: {
        method: "Cash",
        items: [{ qty: 1 }],
        payments: [{ method: "Cash", amount: 10000 }, { method: "QRIS", amount: 5000 }],
      },
    }));
    expect(info.paidTotal).toBe(15000);
    expect(info.amountLabel).toBe("Rp 15.000");
  });

  it("tetap aman tanpa payload", () => {
    const info = queueItemSummary(item({ payload: null }));
    expect(info.summary).toBe("Transaksi");
    expect(info.amountLabel).toBe("");
  });
});

describe("queueItemStatusLabel", () => {
  it("memberi label Bahasa Indonesia", () => {
    expect(queueItemStatusLabel(QUEUE_STATUS.PENDING)).toBe("Menunggu");
    expect(queueItemStatusLabel(QUEUE_STATUS.SYNCING)).toBe("Menyinkronkan");
    expect(queueItemStatusLabel(QUEUE_STATUS.FAILED)).toBe("Gagal");
    expect(queueItemStatusLabel(undefined)).toBe("Menunggu");
  });
});

describe("formatQueueTime", () => {
  it("menampilkan jam saja untuk hari yang sama", () => {
    const now = new Date("2026-11-22T10:00:00.000Z");
    const label = formatQueueTime("2026-11-22T03:00:00.000Z", now);
    expect(label).toMatch(/\d{2}[.:]\d{2}/);
    expect(label).not.toMatch(/[A-Za-z]{3}/);
  });

  it("menyertakan tanggal bila beda hari", () => {
    const now = new Date("2026-11-23T10:00:00.000Z");
    const label = formatQueueTime("2026-11-22T03:00:00.000Z", now);
    expect(label).toMatch(/[A-Za-z]{3}/);
  });

  it("aman terhadap nilai kosong/tak valid", () => {
    expect(formatQueueTime(null)).toBe("-");
    expect(formatQueueTime("bukan tanggal")).toBe("-");
  });
});

describe("queueBadgeTooltip", () => {
  it("memberi teks sesuai status", () => {
    expect(queueBadgeTooltip({ state: QUEUE_BADGE_STATE.IDLE })).toBe("");
    expect(queueBadgeTooltip({ state: QUEUE_BADGE_STATE.SYNCING })).toMatch(/Menyinkronkan/);
    expect(queueBadgeTooltip({ state: QUEUE_BADGE_STATE.FAILED, failed: 3 })).toMatch(/3 transaksi gagal/);
    expect(queueBadgeTooltip({ state: QUEUE_BADGE_STATE.PENDING, pending: 2 })).toMatch(/2 transaksi menunggu/);
  });
});

describe("QUEUE_BADGE_POLL_MS", () => {
  it("berada di rentang polling ringan", () => {
    expect(QUEUE_BADGE_POLL_MS).toBeGreaterThanOrEqual(2000);
    expect(QUEUE_BADGE_POLL_MS).toBeLessThanOrEqual(10000);
  });
});
