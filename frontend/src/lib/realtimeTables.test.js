import {
  TABLES_FALLBACK_POLL_MS,
  TABLES_REALTIME_CHANNEL,
  createTablesReloadScheduler,
  subscribeToTablesRealtime,
} from "./realtimeTables";

const makeClient = () => {
  const handlers = {};
  const subscribeCallbacks = [];
  const channel = {
    on: jest.fn((type, filter, handler) => {
      handlers[type] = { filter, handler };
      return channel;
    }),
    subscribe: jest.fn((cb) => {
      subscribeCallbacks.push(cb);
      return channel;
    }),
    handlers,
    subscribeCallbacks,
  };
  return {
    channel: jest.fn(() => channel),
    removeChannel: jest.fn(() => Promise.resolve("ok")),
    channelRef: channel,
  };
};

describe("subscribeToTablesRealtime", () => {
  it("berlangganan postgres_changes pada tabel tables", () => {
    const client = makeClient();
    const onChange = jest.fn();
    subscribeToTablesRealtime(onChange, { client });

    expect(client.channel).toHaveBeenCalledWith(TABLES_REALTIME_CHANNEL);
    const { filter } = client.channelRef.handlers.postgres_changes;
    expect(filter).toEqual({ event: "*", schema: "public", table: "tables" });
  });

  it("memanggil onChange saat ada perubahan baris", () => {
    const client = makeClient();
    const onChange = jest.fn();
    subscribeToTablesRealtime(onChange, { client });

    client.channelRef.handlers.postgres_changes.handler({ eventType: "UPDATE" });
    client.channelRef.handlers.postgres_changes.handler({ eventType: "INSERT" });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("melaporkan status subscribed dan menonaktifkan fallback", () => {
    const client = makeClient();
    const onStatus = jest.fn();
    subscribeToTablesRealtime(() => {}, { client, onStatus });

    client.channelRef.subscribeCallbacks.forEach((cb) => cb("SUBSCRIBED"));
    expect(onStatus).toHaveBeenCalledWith("subscribed");
  });

  it("melaporkan error agar fallback bisa aktif", () => {
    const client = makeClient();
    const onStatus = jest.fn();
    subscribeToTablesRealtime(() => {}, { client, onStatus });

    client.channelRef.subscribeCallbacks.forEach((cb) => cb("CHANNEL_ERROR", new Error("boom")));
    expect(onStatus).toHaveBeenCalledWith("error", expect.any(Error));
  });

  it("melaporkan unavailable bila Supabase tidak dikonfigurasi", () => {
    const onStatus = jest.fn();
    const unsubscribe = subscribeToTablesRealtime(() => {}, { client: null, onStatus });
    expect(onStatus).toHaveBeenCalledWith("unavailable");
    expect(typeof unsubscribe).toBe("function");
    expect(() => unsubscribe()).not.toThrow();
  });

  it("unsubscribe menutup channel", () => {
    const client = makeClient();
    const unsubscribe = subscribeToTablesRealtime(() => {}, { client });
    unsubscribe();
    expect(client.removeChannel).toHaveBeenCalledWith(client.channelRef);
  });
});

describe("createTablesReloadScheduler", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("menggabungkan rentetan panggilan menjadi satu reload", () => {
    const controller = new AbortController();
    const reload = jest.fn();
    const scheduler = createTablesReloadScheduler(controller, reload, 200);

    scheduler.schedule();
    scheduler.schedule();
    scheduler.schedule();
    jest.advanceTimersByTime(200);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledWith(controller.signal);
  });

  it("tidak reload bila dibatalkan sebelum tenggat", () => {
    const controller = new AbortController();
    const reload = jest.fn();
    const scheduler = createTablesReloadScheduler(controller, reload, 200);

    scheduler.schedule();
    scheduler.cancel();
    jest.advanceTimersByTime(500);

    expect(reload).not.toHaveBeenCalled();
  });

  it("tidak reload setelah controller dibatalkan", () => {
    const controller = new AbortController();
    const reload = jest.fn();
    const scheduler = createTablesReloadScheduler(controller, reload, 200);

    controller.abort();
    scheduler.schedule();
    jest.advanceTimersByTime(500);

    expect(reload).not.toHaveBeenCalled();
  });
});

describe("konstanta realtime", () => {
  it("memakai nama channel dan interval fallback yang wajar", () => {
    expect(TABLES_REALTIME_CHANNEL).toBe("tables-realtime");
    expect(TABLES_FALLBACK_POLL_MS).toBeGreaterThanOrEqual(5000);
  });
});
