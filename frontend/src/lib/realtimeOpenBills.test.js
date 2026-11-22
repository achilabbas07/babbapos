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

// Klien "ketat" yang meniru perilaku Supabase: `channel(topic)` MEMAKAI ULANG
// channel yang sama untuk topik identik, `.on()` melempar bila dipanggil pada
// channel yang sudah di-subscribe, dan `removeChannel` bersifat async (topik
// belum benar-benar dibebaskan seketika).
const makeStrictClient = () => {
  const channels = new Map();
  const created = [];
  const make = (topic) => {
    const state = { joined: false };
    const channel = {
      topic,
      state,
      on: jest.fn((type) => {
        if (state.joined) {
          throw new Error(`cannot add \`${type}\` callbacks for realtime:${topic} after \`subscribe()\`.`);
        }
        return channel;
      }),
      subscribe: jest.fn(() => {
        state.joined = true;
        return channel;
      }),
    };
    return channel;
  };
  return {
    channel: jest.fn((topic) => {
      if (channels.has(topic)) return channels.get(topic);
      const ch = make(topic);
      channels.set(topic, ch);
      created.push(ch);
      return ch;
    }),
    // Penghapusan async: topik belum dibebaskan saat fungsi ini kembali.
    removeChannel: jest.fn((ch) => Promise.resolve().then(() => channels.delete(ch.topic))),
    created,
    channels,
  };
};

describe("subscribeToOpenBillsRealtime", () => {
  it("berlangganan postgres_changes pada tabel open_bills", () => {
    const client = makeClient();
    subscribeToOpenBillsRealtime(() => {}, { client });

    // Topik unik yang diawali nama dasar channel.
    expect(client.channel).toHaveBeenCalledTimes(1);
    expect(client.channel.mock.calls[0][0].startsWith(OPEN_BILLS_REALTIME_CHANNEL)).toBe(true);
    const { filter } = client.channelRef.handlers.postgres_changes;
    expect(filter).toEqual({ event: "*", schema: "public", table: "open_bills" });
  });

  it("memasang binding postgres_changes SEBELUM memanggil subscribe()", () => {
    const client = makeClient();
    subscribeToOpenBillsRealtime(() => {}, { client });

    const onOrder = client.channelRef.on.mock.invocationCallOrder[0];
    const subscribeOrder = client.channelRef.subscribe.mock.invocationCallOrder[0];
    expect(onOrder).toBeLessThan(subscribeOrder);
    expect(client.channelRef.on).toHaveBeenCalledWith(
      "postgres_changes",
      { event: "*", schema: "public", table: "open_bills" },
      expect.any(Function),
    );
  });

  it("tidak melempar saat langganan ulang sebelum cleanup async selesai (StrictMode)", () => {
    const client = makeStrictClient();

    const unsubscribe = subscribeToOpenBillsRealtime(() => {}, { client });
    unsubscribe(); // cleanup: penghapusan channel belum selesai (async)

    // Langganan kedua harus memakai channel BARU -> tidak melempar.
    expect(() => subscribeToOpenBillsRealtime(() => {}, { client })).not.toThrow();
    expect(client.created).toHaveLength(2);
    expect(client.created[0].topic).not.toBe(client.created[1].topic);
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

  it("unsubscribe idempoten (aman dipanggil berulang kali)", () => {
    const client = makeClient();
    const unsubscribe = subscribeToOpenBillsRealtime(() => {}, { client });
    unsubscribe();
    unsubscribe();
    expect(client.removeChannel).toHaveBeenCalledTimes(1);
  });
});
