import { useState } from "react";
import { Minus, Plus, X, Save, CreditCard, ShoppingBag, StickyNote, Lock } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { rp } from "@/lib/api";
import { CustomerCombobox } from "@/components/pos/CustomerCombobox";

export const ORDER_TYPES = [
  { id: "Dine In", label: "Dine In", testid: "dine-in" },
  { id: "Takeaway", label: "Takeaway", testid: "takeaway" },
  { id: "Walk In", label: "Walk In", testid: "walk-in", direct: true },
  { id: "Ojek Online", label: "Ojol", testid: "ojol", direct: true },
];
export const isDirectPay = (type) => ORDER_TYPES.some((t) => t.id === type && t.direct);

const inputCls = "h-9 min-w-0 rounded-lg border border-border bg-transparent px-3 text-sm outline-none focus:border-primary";

const OrderOptions = ({ order, setOrder, tables, customers, waiters, canPay, waiterRequired }) => {
  const freeTables = tables.filter((t) => t.kind !== "fixture" && (
    t.status !== "occupied" || t.orderData?.openBillId === order.billId || t.id === order.tableId
  ));
  const set = (patch) => setOrder((o) => ({ ...o, ...patch }));
  const types = ORDER_TYPES.filter((t) => canPay || !t.direct);
  return (
    <div className="space-y-2">
      <div className="grid gap-1 rounded-xl bg-secondary p-1" style={{ gridTemplateColumns: `repeat(${types.length}, minmax(0, 1fr))` }}>
        {types.map((t) => (
          <button
            key={t.id}
            data-testid={`order-type-${t.testid}`}
            onClick={() => set({ type: t.id, tableId: t.id === "Dine In" ? order.tableId : "none" })}
            className={`h-8 rounded-lg text-xs font-semibold transition-colors ${order.type === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {isDirectPay(order.type) && (
        <p data-testid="order-direct-pay-note" className="text-[11px] text-muted-foreground">
          {order.type === "Ojek Online" ? "Harga Ojol dipakai · langsung bayar, tanpa meja." : "Tanpa meja · langsung bayar."}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Select value={order.tableId} onValueChange={(v) => set({ tableId: v })} disabled={order.type !== "Dine In"}>
          <SelectTrigger data-testid="order-table-select" className="h-9"><SelectValue placeholder="Meja" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Tanpa meja</SelectItem>
            {freeTables.map((t) => <SelectItem key={t.id} value={t.id}>{t.name} · {t.area}</SelectItem>)}
          </SelectContent>
        </Select>
        <CustomerCombobox
          value={order.customerId}
          customers={customers}
          onChange={(v) => set({ customerId: v, customerName: v === "none" ? "" : customers.find((c) => c.id === v)?.name || "" })}
        />
      </div>
      {waiterRequired && (
        <p data-testid="order-waiter-required-note" className="text-[11px] text-amber-600">
          Nama pelayan wajib dipilih untuk transaksi Kasir/Admin.
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <input data-testid="order-customer-name-input" value={order.customerName} onChange={(e) => set({ customerName: e.target.value })}
          placeholder={order.type === "Ojek Online" ? "Nama / No. order" : "Nama pemesan"} className={inputCls} />
        <Select value={order.waiterId || "none"} onValueChange={(v) => set({ waiterId: v === "none" ? null : v, waiterName: v === "none" ? "" : waiters.find((w) => w.id === v)?.name || "" })}>
          <SelectTrigger data-testid="order-waiter-select" className="h-9"><SelectValue placeholder="Pelayan" /></SelectTrigger>
          <SelectContent>
            {!waiterRequired && <SelectItem value="none">Tanpa pelayan</SelectItem>}
            {waiters.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};

const CartLine = ({ item, price, locked, onQty, onNotes, onRemove, currentWaiterId }) => {
  const [editNote, setEditNote] = useState(false);
  // Tampilkan pemilik baris hanya bila berbeda dari pelayan yang sedang dipilih,
  // sehingga batch lama (mis. sebelum over shift) tetap terlihat jelas.
  const ownerBadge = item.waiterName && (item.waiterId || null) !== (currentWaiterId || null)
    ? item.waiterName
    : null;
  return (
    <div data-testid={`cart-item-${item.key}`} className="rounded-lg border border-border px-2.5 py-1.5">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-1 text-[13px] font-semibold leading-tight">
            {locked && <Lock data-testid={`cart-locked-${item.key}`} className="h-3 w-3 shrink-0 text-amber-600" />}
            <span data-testid={`cart-item-name-${item.key}`} className="min-w-0 flex-1 truncate">{item.variantName || item.name}</span>
          </p>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
            <p className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">{rp(price)}{item.notes && !editNote ? ` · ${item.notes}` : ""}</p>
            {ownerBadge && (
              <span data-testid={`cart-item-waiter-${item.key}`} title={`Pelayan: ${ownerBadge}`} className="max-w-[7.5rem] shrink-0 truncate rounded bg-secondary px-1 text-[10px] font-medium leading-4 text-muted-foreground">
                {ownerBadge}
              </span>
            )}
          </div>
        </div>
        <button data-testid={`cart-note-toggle-${item.key}`} onClick={() => setEditNote((v) => !v)} title="Catatan"
          className={`grid h-7 w-7 place-items-center rounded-md ${item.notes ? "text-primary" : "text-muted-foreground"} hover:bg-secondary`}>
          <StickyNote className="h-3.5 w-3.5" />
        </button>
        <div className="flex shrink-0 items-center rounded-md border border-border">
          <button data-testid={`cart-dec-${item.key}`} onClick={() => onQty(-1)} className="grid h-7 w-7 place-items-center"><Minus className="h-3 w-3" /></button>
          <span data-testid={`cart-qty-${item.key}`} className="min-w-6 px-0.5 text-center font-mono text-xs font-semibold">{item.qty}</span>
          <button data-testid={`cart-inc-${item.key}`} onClick={() => onQty(1)} className="grid h-7 w-7 place-items-center"><Plus className="h-3 w-3" /></button>
        </div>
        <span className="min-w-[72px] shrink-0 whitespace-nowrap text-right font-mono text-xs font-semibold">{rp(price * item.qty)}</span>
        <button data-testid={`cart-remove-${item.key}`} onClick={onRemove} className="shrink-0 text-muted-foreground hover:text-destructive"><X className="h-3.5 w-3.5" /></button>
      </div>
      {editNote && (
        <input data-testid={`cart-notes-${item.key}`} autoFocus value={item.notes} onChange={(e) => onNotes(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && setEditNote(false)} placeholder="Catatan (mis. less sugar)"
          className="mt-1.5 h-7 w-full rounded-md border border-border bg-transparent px-2 text-xs outline-none focus:border-primary" />
      )}
    </div>
  );
};

export const CartPanel = ({ order, setOrder, tables, customers, waiters, waiterRequired, cart, setCart, priceOf, total, canPay, busy, onSaveBill, onPay, onReset, onQty, onRemove, isLocked }) => {
  const notes = (id, v) => setCart((c) => c.map((i) => (i.key === id ? { ...i, notes: v } : i)));
  const canBill = !isDirectPay(order.type);
  const count = cart.reduce((s, i) => s + i.qty, 0);

  return (
    <aside data-testid="cart-panel" className="flex flex-col rounded-2xl border border-border bg-card shadow-sm md:sticky md:top-[5.5rem] md:h-[calc(100vh-6.5rem)] md:min-h-[560px]">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <p className="text-sm font-semibold">
          Pesanan {order.billId && <span data-testid="cart-bill-id" className="font-mono text-primary">#{order.billId}</span>}
          <span data-testid="cart-count" className="ml-2 text-xs font-normal text-muted-foreground">{cart.length} menu · {count} item</span>
        </p>
        {(cart.length > 0 || order.billId) && <button data-testid="cart-reset-button" onClick={onReset} className="text-xs text-muted-foreground hover:text-foreground">Pesanan baru</button>}
      </div>
      <div className="border-b border-border px-4 py-2.5"><OrderOptions order={order} setOrder={setOrder} tables={tables} customers={customers} waiters={waiters} canPay={canPay} waiterRequired={waiterRequired} /></div>
      <div data-testid="cart-list" className="min-h-[312px] flex-1 space-y-1.5 overflow-y-auto px-3 py-2.5">
        {cart.length === 0 ? (
          <div className="grid h-full place-items-center text-center text-sm text-muted-foreground">
            <div><ShoppingBag className="mx-auto mb-2 h-7 w-7" />Ketuk menu untuk menambahkan</div>
          </div>
        ) : (
          cart.map((i) => <CartLine key={i.key} item={i} price={priceOf(i)} locked={isLocked(i)} currentWaiterId={order.waiterId} onQty={(d) => onQty(i.key, d)} onNotes={(v) => notes(i.key, v)} onRemove={() => onRemove(i.key)} />)
        )}
      </div>
      <div className="space-y-2.5 border-t border-border px-4 py-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">Total {order.type === "Ojek Online" && <span className="text-xs text-primary">(harga Ojol)</span>}</span>
          <span data-testid="cart-total" className="font-mono text-xl font-bold text-primary">{rp(total)}</span>
        </div>
        <div className={`grid gap-2 ${canPay && canBill ? "grid-cols-2" : "grid-cols-1"}`}>
          {canBill && (
            <button data-testid="save-open-bill-button" disabled={!cart.length || busy} onClick={onSaveBill}
              className="flex h-11 items-center justify-center gap-2 rounded-xl border border-border font-semibold transition-colors hover:border-primary disabled:opacity-40">
              <Save className="h-4 w-4" /> {order.billId ? "Update Bill" : "Open Bill"}
            </button>
          )}
          {canPay && (
            <button data-testid="pay-button" disabled={!cart.length || busy} onClick={onPay}
              className="flex h-11 items-center justify-center gap-2 rounded-xl bg-primary font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40">
              <CreditCard className="h-4 w-4" /> Bayar
            </button>
          )}
        </div>
      </div>
    </aside>
  );
};
