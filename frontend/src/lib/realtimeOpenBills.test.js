import {
  OPEN_BILLS_REALTIME_CHANNEL,
  subscribeToOpenBillsRealtime,
} from "./realtimeOpenBills";

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

describe("subscribeToOpenBillsRealtime", () => {
  it("berlangganan postgres_changes pada tabel open_bills", () => {
    const client = makeClient();
    subscribeToOpenBillsRealtime(() => {}, { client });

    expect(client.channel).toHaveBeenCalledWith(OPEN_BILLS_REALTIME_CHANNEL);
    const { filter } = client.channelRef.handlers.postgres_changes;
    expect(filter).toEqual({ event: "*", schema: "public", table: "open_bills" });
  });

  it("memanggil onChange saat ada perubahan baris", () => {
    const client = makeClient();
    const onChange = jest.fn();
    subscribeToOpenBillsRealtime(onChange, { client });

    client.channelRef.handlers.postgres_changes.handler({ eventType: "INSERT" });
    client.channelRef.handlers.postgres_changes.handler({ eventType: "DELETE" });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("melaporkan status subscribed dan error", () => {
    const client = makeClient();
    const onStatus = jest.fn();
    subscribeToOpenBillsRealtime(() => {}, { client, onStatus });

    client.channelRef.subscribeCallbacks.forEach((cb) => cb("SUBSCRIBED"));
    expect(onStatus).toHaveBeenCalledWith("subscribed");

    const errorClient = makeClient();
    const errorStatus = jest.fn();
    subscribeToOpenBillsRealtime(() => {}, { client: errorClient, onStatus: errorStatus });
    errorClient.channelRef.subscribeCallbacks.forEach((cb) => cb("CHANNEL_ERROR", new Error("boom")));
    expect(errorStatus).toHaveBeenCalledWith("error", expect.any(Error));
  });

  it("melaporkan unavailable bila Supabase tidak dikonfigurasi", () => {
    const onStatus = jest.fn();
    const unsubscribe = subscribeToOpenBillsRealtime(() => {}, { client: null, onStatus });
    expect(onStatus).toHaveBeenCalledWith("unavailable");
    expect(typeof unsubscribe).toBe("function");
    expect(() => unsubscribe()).not.toThrow();
  });

  it("unsubscribe menutup channel", () => {
    const client = makeClient();
    const unsubscribe = subscribeToOpenBillsRealtime(() => {}, { client });
    unsubscribe();
    expect(client.removeChannel).toHaveBeenCalledTimes(1);
  });
});
