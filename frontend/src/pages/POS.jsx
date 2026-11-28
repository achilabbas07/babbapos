import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useProfile } from "@/context/ProfileContext";
import { api, errMsg, errorCode, fmtDate, itemKey, itemName, isNetworkError, isFetchNetworkError, NETWORK_ERROR_MESSAGE } from "@/lib/api";
import { CACHE_KEYS, saveCache, readCacheData, variantsCacheKey, openBillCacheKey, enqueueTransaction, makeClientRequestId, countTransactionQueue, getTransactionQueue } from "@/lib/localStore";
import { loadWithCache } from "@/lib/offlineRead";
import { offlineOrderFromBill, pendingOpenBillsFromQueue } from "@/lib/offlineOpenBills";
import { ProductGrid } from "@/components/pos/ProductGrid";
import { CartPanel } from "@/components/pos/CartPanel";
import { PayDialog } from "@/components/pos/PayDialog";
import { ReceiptDialog } from "@/components/ReceiptDialog";
import { AdminPinDialog } from "@/components/tables/AdminPinDialog";
import { VariantDialog } from "@/components/pos/VariantDialog";
import { supabase } from "@/supabaseClient";
import { printBluetoothReceipt, printerTypeForDocType } from "@/lib/bluetoothThermalPrinter";
import { buildKitchenPrintData, unprintedKitchenItems } from "@/lib/kitchenTicket";
import { roleRequiresWaiter, waiterValidationMessage } from "@/lib/orderValidation";
import { ojolVariantPrice, resolveOjolMarkupPercent } from "@/lib/ojolPricing";
import { notifyOpenBillsChanged } from "@/lib/openBillCount";

const emptyOrder = (user) => ({
  billId: null, queueNumber: null, type: "Dine In", tableId: "none", customerId: "none", customerName: "", waiterName: user.role === "waiter" ? user.name : "", waiterId: user.role === "waiter" ? user.id : null,
});

const getNextQueueNumber = async () => {
  if (!supabase) throw new Error("Supabase belum dikonfigurasi untuk membuat nomor urut.");
  const { data: queueNumber, error } = await supabase.rpc("increment_bill_seq");
  if (error) throw error;
  if (queueNumber === null || queueNumber === undefined) {
    throw new Error("Supabase tidak mengembalikan nomor urut bill.");
  }
  return queueNumber;
};

// Fallback nomor urut saat server/Supabase tak terjangkau (offline). Nomor ini
// HANYA dipakai untuk bill yang disimpan ke antrean offline; saat antrean
// dikirim ulang, server tetap memberi nomor otoritatifnya sendiri. Bertambah
// lokal (Timestamp dibagi 1000) agar tidak pernah kembali ke nilai yang sudah
// pernah terpakai selama sesi berjalan.
let localQueueSeq = 0;
const getLocalQueueNumber = () => {
  const base = Math.floor(Date.now() / 1000);
  localQueueSeq = Math.max(base, localQueueSeq + 1);
  return localQueueSeq;
};

const createItemId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  throw new Error("Browser ini tidak mendukung pembuatan ID item yang aman.");
};

const cartItemKey = (item) => `${itemKey(item)}:${item.id || ""}`;

export default function POS() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [products, setProducts] = useState([]);
  const [stock, setStock] = useState({});
  const [tables, setTables] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [waiters, setWaiters] = useState([]);
  const [order, setOrder] = useState(() => emptyOrder(user));
  const [cart, setCart] = useState([]);
  const [payOpen, setPayOpen] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState({});
  const [authPin, setAuthPin] = useState(null);
  const [pending, setPending] = useState(null);
  const [variants, setVariants] = useState([]);
  const [variantFor, setVariantFor] = useState(null);
  const [ojolMarkup, setOjolMarkup] = useState(() => resolveOjolMarkupPercent());

  // Muat data master dengan dukungan cache lokal (Tahap 1 Offline Read).
  // - Fetch berhasil  -> state diperbarui seperti biasa + hasilnya di-cache.
  // - Fetch gagal      -> pakai data cache terakhir bila ada (halaman tetap
  //   menampilkan menu/varian/meja/pelanggan/pelayan tanpa error kosong).
  // Tidak mengubah alur transaksi/checkout: hanya baca/tulis cache lokal.
  const loadRefs = useCallback(async () => {
    let firstError = null;
    const loadOne = async (cacheKey, request, apply, { silent = false } = {}) => {
      try {
        const res = await request();
        const data = res?.data;
        apply(data);
        saveCache(cacheKey, data);
        return true;
      } catch (e) {
        const cached = await readCacheData(cacheKey);
        if (cached != null) {
          apply(cached);
          return true;
        }
        if (!silent && !firstError) firstError = e;
        return false;
      }
    };

    const results = await Promise.all([
      loadOne(CACHE_KEYS.PRODUCTS, () => api.get("/products"), setProducts),
      loadOne(CACHE_KEYS.TABLES, () => api.get("/tables"), setTables),
      loadOne(CACHE_KEYS.CUSTOMERS, () => api.get("/customers"), setCustomers),
      loadOne(CACHE_KEYS.WAITERS, () => api.get("/users/waiters"), setWaiters),
      // Stok & markup bersifat pelengkap: gagal tanpa cache tidak perlu toast.
      loadOne(CACHE_KEYS.PRODUCTS_STOCK, () => api.get("/products/stock"), setStock, { silent: true }),
      loadOne(
        CACHE_KEYS.OJOL_MARKUP,
        () => api.get("/settings/ojol-markup"),
        (data) => { if (data?.markup_percent != null) setOjolMarkup(resolveOjolMarkupPercent(data.markup_percent)); },
        { silent: true },
      ),
    ]);
    if (results.some((ok) => !ok) && firstError) toast.error(errMsg(firstError));
  }, []);

  useEffect(() => {
    loadRefs();
  }, [loadRefs]);

  useEffect(() => {
    const controller = new AbortController();
    const billId = params.get("bill");
    const offlineBillId = params.get("offline-bill");
    const tableId = params.get("table");
    if (offlineBillId) {
      // Bill yang masih mengantre di antrean offline belum ada di server; muat
      // langsung dari antrean lokal agar keranjang tetap bisa dibuka untuk
      // menambah item (yang nanti ikut mengantre sebagai open-bill-update).
      getTransactionQueue().then((queue) => {
        if (controller.signal.aborted) return;
        const found = pendingOpenBillsFromQueue(queue).find((b) => b.id === offlineBillId);
        if (!found) {
          toast.error("Open Bill antrean tidak ditemukan atau sudah tersinkron.");
          return;
        }
        const order = offlineOrderFromBill(found);
        const billItems = found.items_json.map((i) => {
          const id = i.id || createItemId();
          return {
            key: cartItemKey({ ...i, id }), id, is_printed: Boolean(i.is_printed),
            productId: i.productId, variantId: i.variantId ?? null, extra: 0,
            variantName: i.variantName || "", name: itemName(i), price: i.price, qty: i.qty,
            notes: i.notes || "", waiterId: i.waiterId ?? null, waiterName: i.waiterName || "",
          };
        });
        setOrder(order);
        setCart(billItems);
        setSaved(Object.fromEntries(billItems.map((i) => [i.key, i.qty])));
        setAuthPin(null);
      });
    } else if (billId) {
      // Fallback cache offline: bila detail bill gagal karena jaringan, pakai
      // salinan terakhir dari cache lokal supaya keranjang tetap bisa dibuka
      // untuk menambah item / melanjutkan pesanan tanpa error "tidak ada jaringan".
      loadWithCache(openBillCacheKey(billId), async () => (await api.get(`/open-bills/${billId}`, { signal: controller.signal })).data)
        .then(({ data, canceled, error }) => {
        if (canceled) return;
        if (!data?.id) {
          if (error && !controller.signal.aborted) toast.error(errMsg(error));
          return;
        }
        const billItems = data.items_json.map((i) => {
          const id = i.id || createItemId();
          // `waiterId`/`waiterName` per item dipertahankan agar batch order lama
          // tetap tercatat atas nama pelayan aslinya saat tambah order.
          return {
            key: cartItemKey({ ...i, id }), id, is_printed: Boolean(i.is_printed),
            productId: i.productId, variantId: i.variantId ?? null, extra: i.variantPrice || 0,
            variantName: i.variantName || "", name: itemName(i), price: i.price, qty: i.qty,
            notes: i.notes || "", waiterId: i.waiterId ?? null, waiterName: i.waiterName || "",
          };
        });
        setOrder({ billId: data.id, queueNumber: data.queueNumber ?? null, type: data.type, tableId: data.tableId || "none", customerId: data.customerId || "none", customerName: data.customerName, waiterName: data.waiterName, waiterId: data.waiterId || null });
        setCart(billItems);
        setSaved(Object.fromEntries(billItems.map((i) => [i.key, i.qty])));
        setAuthPin(null);
        }).catch((e) => {
          if (!controller.signal.aborted) toast.error(errMsg(e));
        });
    } else if (tableId) {
      setOrder((o) => ({ ...o, type: "Dine In", tableId }));
    }
    return () => controller.abort();
  }, [params]);

  const addLine = useCallback((p, v) => {
    const key = `${p.id}:${v ? v.id : ""}`;
    const id = createItemId();
    // Baris baru langsung dicap pelayan yang sedang dipilih, sehingga pelayan
    // yang dipilih berikutnya tidak menimpa baris ini.
    const owner = { waiterId: order.waiterId || null, waiterName: order.waiterName || "" };
    // Hanya gabungkan ke baris yang belum dicetak DAN milik pelayan yang sama.
    // Baris milik pelayan lain dibiarkan utuh agar tidak ikut berpindah nama.
    const sameOwner = (i) => (i.waiterId || null) === owner.waiterId
      && (i.waiterName || "") === owner.waiterName;
    const mergeable = (i) => itemKey(i) === key && !i.is_printed && sameOwner(i);
    setCart((c) => (c.some(mergeable)
      ? c.map((i) => (mergeable(i) ? { ...i, qty: i.qty + 1 } : i))
      : [...c, { key: `${key}:${id}`, id, is_printed: false, productId: p.id, variantId: v ? v.id : null, extra: v ? Number(v.additional_price || 0) : 0, variantName: v ? v.variant_name : "", name: v ? v.variant_name : p.name, price: p.price, qty: 1, notes: "", ...owner }]));
  }, [order.waiterId, order.waiterName]);
  const variantsOf = (p) => variants.filter((v) => v.pid === p.id);
  const add = useCallback(async (p) => {
    const cacheKey = variantsCacheKey(p.id);
    let data;
    try {
      const res = await api.get("/menu-variants", { params: { product_id: p.id } });
      data = res.data;
      saveCache(cacheKey, data); // simpan varian produk untuk mode offline
    } catch (e) {
      // Fallback offline: pakai varian terakhir dari cache bila tersedia.
      const cached = await readCacheData(cacheKey);
      if (cached == null) {
        toast.error(errMsg(e));
        return;
      }
      data = cached;
    }
    const rows = Array.isArray(data) ? data : [];
    setVariants((vs) => [...vs.filter((v) => v.pid !== p.id), ...rows.map((v) => ({ ...v, pid: p.id }))]);
    if (rows.length) setVariantFor(p);
    else addLine(p, null);
  }, [addLine]);

  const reset = () => {
    setOrder(emptyOrder(user));
    setCart([]);
    setSaved({});
    setAuthPin(null);
    setParams({});
  };

  const needsAuth = user.role !== "admin" && !!order.billId && !authPin;
  const isLocked = (i) => needsAuth && (saved[i.key] || 0) > 0 && i.qty <= saved[i.key];
  const guarded = (id, newQty, apply) => {
    if (needsAuth && newQty < (saved[id] || 0)) setPending(() => apply);
    else apply();
  };
  const changeQty = (id, d) => {
    const item = cart.find((i) => i.key === id);
    guarded(id, item.qty + d, () => setCart((c) => c.map((i) => (i.key === id ? { ...i, qty: i.qty + d } : i)).filter((i) => i.qty > 0)));
  };
  const removeItem = (id) => guarded(id, 0, () => setCart((c) => c.filter((i) => i.key !== id)));

  const payload = () => ({
    queueNumber: order.queueNumber,
    type: order.type,
    tableId: order.type === "Dine In" && order.tableId !== "none" ? order.tableId : null,
    customerId: order.customerId !== "none" ? order.customerId : null,
    customerName: order.customerName,
    waiterName: order.waiterName,
    waiterId: order.waiterId || null,
    adminPin: authPin,
    // Sertakan atribusi pelayan per item agar item yang sudah tersimpan tidak
    // ikut berpindah nama ketika pelayan diganti pada tambah order.
    // `productName`/`variantName`/`price` bersifat TAMPILAN saja (dipakai untuk
    // memproyeksikan bill antrean offline di dialog detail meja). Server tetap
    // menghitung ulang nama & harga/HPP dari `productId`/`variantId`, jadi angka
    // yang ditagih tidak berubah.
    items: cart.map((i) => ({
      id: i.id, is_printed: i.is_printed, productId: i.productId, qty: i.qty, notes: i.notes, variantId: i.variantId,
      waiterId: i.waiterId ?? null, waiterName: i.waiterName || "",
      productName: i.name || "",
      variantName: i.variantName || "",
      price: priceOf(i),
    })),
  });

  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      if (user.role === "admin" && errorCode(e) === "SHIFT_NOT_OPEN") {
        setPayOpen(false);
        toast.error(errMsg(e));
        nav("/cash");
        return;
      }
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  // Kirim item baru ke printer dapur secara otomatis. Dipakai baik saat menyimpan
  // open bill maupun saat pembayaran langsung (tanpa open bill), sehingga dapur
  // tidak pernah terlewat hanya karena pelanggan membayar lunas di awal.
  const autoPrintKitchenTicket = async (source, { tableName } = {}) => {
    const isAddOn = (source?.items_json || []).some((item) => item.is_printed);
    const ticket = buildKitchenPrintData(source, { isAddOn, tableName, time: fmtDate(source?.timestamp || source?.date) });
    if (!ticket) return;
    const itemIds = unprintedKitchenItems(source.items_json).map((item) => item.id);
    try {
      if (itemIds.some((id) => typeof id !== "string" || !id)) {
        throw new Error("ID item belum tersedia untuk menandai status cetak.");
      }
      await printBluetoothReceipt("kitchen", ticket, { printerType: printerTypeForDocType("kitchen") });
      if (!supabase) {
        throw new Error("Supabase belum dikonfigurasi untuk menyimpan status cetak dapur.");
      }
      const { error } = await supabase.rpc("mark_json_items_as_printed", {
        p_bill_id: source.id,
        p_item_ids: itemIds,
      });
      if (error) {
        // Offline / fetch gagal: tiket sudah tercetak, jadi jangan tampilkan
        // pesan teknis `TypeError: Failed to fetch`.
        if (isFetchNetworkError(error)) {
          throw new Error(`Tiket tercetak, tetapi status cetak belum tersimpan: ${NETWORK_ERROR_MESSAGE}`);
        }
        throw new Error(`Tiket tercetak, tetapi status cetak gagal disimpan: ${error.message}`);
      }
      toast.success("Pesanan dapur tercetak otomatis.");
    } catch (error) {
      toast.error(`Pesanan tersimpan, tetapi tiket dapur gagal dicetak: ${error?.message || "Terjadi kesalahan."}`);
    }
  };

  // Terapkan data bill ke state + cache lokal (dipakai baik saat online maupun
  // fallback offline) lalu cetak tiket dapur.
  const playSaveResponse = async (data) => {
    const kitchenItems = (data.items_json || []).map((i) => ({
      ...i, is_printed: false, key: cartItemKey({ ...i, id: i.id || createItemId() }),
    }));
    if (data.id) saveCache(openBillCacheKey(data.id), data);
    toast.success(`Open bill ${data.id} tersimpan`);
    await autoPrintKitchenTicket(
      { ...data, items_json: kitchenItems },
      { tableName: tables.find((table) => table.id === data.tableId)?.name },
    );
    notifyOpenBillsChanged();
    reset();
    loadRefs();
  };

  const saveBill = () => run(async () => {
    const blocked = waiterValidationMessage(user.role, order);
    if (blocked) {
      toast.error(blocked);
      return;
    }
    const billId = order.billId;
    const clientRequestId = makeClientRequestId();
    const body = { ...payload(), client_request_id: clientRequestId };
    if (!billId) {
      try {
        body.queueNumber = await getNextQueueNumber();
      } catch (queueError) {
        if (isNetworkError(queueError)) body.queueNumber = getLocalQueueNumber();
        else throw queueError;
      }
    }
    try {
      const { data } = billId ? await api.put(`/open-bills/${billId}`, body) : await api.post("/open-bills", body);
      await playSaveResponse(data);
    } catch (saveError) {
      if (!isNetworkError(saveError)) throw saveError;
      // Gagal jaringan: simpan aksi ke antrean persisten (Tahap 2), lengkap
      // dengan `client_request_id`, agar dikirim ulang otomatis saat online.
      // Payload TIDAK menyertakan `billId` (menghindari kunci idempoten server).
      const queueBody = { ...body };
      const meta = billId
        ? { type: "open-bill-update", clientRequestId }
        : { type: "open-bill-create", clientRequestId };
      if (billId) queueBody.billId = billId;
      const item = await enqueueTransaction(queueBody, meta);
      if (!item) {
        toast.error("Gagal menyimpan Open Bill ke antrean offline. Periksa penyimpanan perangkat lalu coba lagi.");
        return;
      }
      if (billId && order.queueNumber != null) {
        saveCache(openBillCacheKey(billId), { ...(await readCacheData(openBillCacheKey(billId)) || {}), id: billId, queueNumber: order.queueNumber, items_json: body.items });
      }
      const pending = await countTransactionQueue();
      toast.warning(
        `Koneksi terputus. Open Bill disimpan di antrean offline${pending ? ` (${pending} antrean)` : ""}; akan dikirim otomatis saat online kembali.`,
      );
      reset();
      loadRefs();
    }
  });

  // Checkout offline: simpan transaksi ke antrean lokal untuk dikirim otomatis
  // saat online kembali, lalu kosongkan keranjang seperti checkout normal.
  // `clientRequestId` (kunci idempotensi) dipakai agar sinkronisasi nanti tidak
  // menghasilkan transaksi ganda.
  const enqueueOfflineCheckout = async ({ method, cashGiven, extra = {}, queueNumber = null, clientRequestId }) => {
    const item = await enqueueTransaction(
      { ...payload(), queueNumber, method, cashGiven, openBillId: order.billId, ...extra, client_request_id: clientRequestId },
      { type: order.billId ? "open-bill-payment" : "direct-payment", clientRequestId },
    );
    setPayOpen(false);
    if (!item) {
      toast.error("Gagal menyimpan transaksi offline. Periksa penyimpanan perangkat lalu coba lagi.");
      return;
    }
    toast.warning(
      "Koneksi ke server terputus. Transaksi telah disimpan di antrean offline dan akan dikirim otomatis saat online kembali.",
    );
    reset();
  };

  const pay = (method, cashGiven, extra = {}) => run(async () => {
    const blocked = waiterValidationMessage(user.role, order);
    if (blocked) {
      setPayOpen(false);
      toast.error(blocked);
      return;
    }
    // Satu `client_request_id` (kunci idempotensi) per pembayaran, dipakai untuk
    // payload online maupun bila harus masuk antrean offline.
    const clientRequestId = makeClientRequestId();
    // Nomor urut bill butuh Supabase (online). Saat offline/tanpa Supabase,
    // checkout walk-in TIDAK digagalkan: transaksi masuk antrean lokal.
    let queueNumber;
    try {
      queueNumber = order.billId ? order.queueNumber : await getNextQueueNumber();
    } catch (queueError) {
      if (!order.billId && isNetworkError(queueError)) {
        await enqueueOfflineCheckout({ method, cashGiven, extra, clientRequestId });
        return;
      }
      throw queueError;
    }
    const body = { ...payload(), queueNumber, method, cashGiven, openBillId: order.billId, ...extra, client_request_id: clientRequestId };
    let data;
    try {
      ({ data } = await api.post("/transactions", body));
    } catch (postError) {
      // Gagal karena jaringan (BUKAN 4xx validasi bisnis) dan bukan pembayaran
      // open bill -> simpan ke antrean offline untuk disinkronkan saat online.
      if (!order.billId && isNetworkError(postError)) {
        await enqueueOfflineCheckout({ method, cashGiven, extra, queueNumber, clientRequestId });
        return;
      }
      throw postError;
    }
    setPayOpen(false);
    setReceipt(data);
    toast.success(`Transaksi ${data.id} berhasil`);
    // Pembayaran langsung (Walk In/Ojol, atau Dine In tanpa open bill) tetap
    // mengirim pesanan ke dapur karena tidak melewati tombol Open Bill.
    if (!order.billId) {
      await autoPrintKitchenTicket(data, { tableName: tables.find((table) => table.id === data.tableId)?.name || data.tableName });
    }
    notifyOpenBillsChanged();
    reset();
    loadRefs();
  });

  const ojol = order.type === "Ojek Online";
  const priceOf = (item) => {
    const p = products.find((x) => x.id === item.productId);
    if (!p) return item.price;
    return ojolVariantPrice(p, item.extra, ojolMarkup, ojol);
  };
  const total = cart.reduce((s, i) => s + priceOf(i) * i.qty, 0);

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_340px] lg:grid-cols-[minmax(0,1fr)_350px] xl:grid-cols-[minmax(0,1fr)_380px]">
      <ProductGrid products={products} stock={stock} onAdd={add} ojol={ojol} />
      <VariantDialog product={variantFor} variants={variantFor ? variantsOf(variantFor) : []} onClose={() => setVariantFor(null)}
        basePrice={variantFor ? ojolVariantPrice(variantFor, 0, ojolMarkup, ojol) : 0}
        priceOf={(v) => ojolVariantPrice(variantFor, v.additional_price, ojolMarkup, ojol)}
        onPick={(v) => { addLine(variantFor, v); setVariantFor(null); }} />
      <CartPanel
        order={order} setOrder={setOrder} tables={tables} customers={customers} waiters={waiters} waiterRequired={roleRequiresWaiter(user.role)} cart={cart} setCart={setCart} priceOf={priceOf} total={total}
        canPay={user.role !== "waiter"} busy={busy} onQty={changeQty} onRemove={removeItem} isLocked={isLocked} onSaveBill={saveBill} onPay={() => setPayOpen(true)} onReset={reset}
      />
      <PayDialog open={payOpen} onOpenChange={setPayOpen} total={total} onPay={pay} busy={busy} customerId={order.customerId !== "none" ? order.customerId : null} />
      <ReceiptDialog trx={receipt} onClose={() => setReceipt(null)} autoPrint={!!profile.cetakOtomatis} />
      <AdminPinDialog open={!!pending} onClose={() => setPending(null)} testid="reduce-pin" needPin title="Otorisasi Admin"
        description="Item ini sudah tersimpan di bill. Mengurangi atau menghapus item butuh PIN admin."
        onSubmit={async ({ pin }) => { await api.post("/auth/verify-admin", { pin }); setAuthPin(pin); pending(); setPending(null); }} />
    </div>
  );
}
