import { useEffect, useState } from "react";
import { Banknote, QrCode, CreditCard, Landmark, TicketPercent, Gift, Plus, X, Delete } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AdminPinDialog } from "@/components/tables/AdminPinDialog";
import { api, rp } from "@/lib/api";
import { appendLeg as appendSplitLeg, isSplitSettled, splitPayArgs } from "@/lib/splitPayment";

const METHODS = [
  { id: "Cash", icon: Banknote },
  { id: "QRIS", icon: QrCode },
  { id: "Card", icon: CreditCard },
  { id: "Debit", icon: Landmark },
];

const Line = ({ label, value, tone = "", testid, onRemove }) => (
  <div className="flex items-center justify-between text-sm">
    <span className="flex items-center gap-1.5 text-muted-foreground">
      {label}
      {onRemove && <button data-testid={`${testid}-remove`} onClick={onRemove} className="hover:text-destructive"><X className="h-3.5 w-3.5" /></button>}
    </span>
    <span data-testid={testid} className={`font-mono font-semibold ${tone}`}>{value}</span>
  </div>
);

const NUMPAD_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "000", "0", "back"];

const DiscountArea = ({ promoCode, setPromoCode, onPromo, onPoints, customerId, hasPromo, hasPoints }) => (
  <div data-testid="discount-area" className="space-y-2 rounded-xl border border-dashed border-primary/40 bg-primary/5 p-3">
    <p className="text-xs font-semibold uppercase tracking-wider text-primary">Diskon &amp; Hadiah</p>
    <div className="flex gap-2">
      <input data-testid="promo-code-input" value={promoCode} onChange={(e) => setPromoCode(e.target.value.toUpperCase())} placeholder="Kode promo" disabled={hasPromo}
        className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-white px-3 font-mono text-sm uppercase outline-none focus:border-primary disabled:opacity-60" />
      <button type="button" data-testid="apply-promo-button" disabled={!promoCode.trim() || hasPromo} onClick={onPromo}
        className="flex h-10 touch-manipulation items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-40">
        <TicketPercent className="h-4 w-4" />Pakai
      </button>
    </div>
    <button type="button" data-testid="redeem-points-button" disabled={!customerId || hasPoints} onClick={onPoints}
      className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-primary/50 bg-white text-sm font-semibold text-primary disabled:opacity-40">
      <Gift className="h-4 w-4" />{customerId ? "Tukar 100 Poin" : "Tukar 100 Poin (pilih pelanggan dulu)"}
    </button>
  </div>
);

export const PayDialog = ({ open, onOpenChange, total: subtotal, onPay, busy, customerId }) => {
  const [method, setMethod] = useState("Cash");
  const [cash, setCash] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [promo, setPromo] = useState(null);
  const [points, setPoints] = useState(null);
  const [pinFor, setPinFor] = useState(null);
  const [pin, setPin] = useState(null);
  const [legs, setLegs] = useState([]);
  const [activeLeg, setActiveLeg] = useState(0);

  useEffect(() => {
    if (open) {
      setMethod("Cash");
      setCash("");
      setPromoCode("");
      setPromo(null);
      setPoints(null);
      setPin(null);
      setLegs([]);
      setActiveLeg(0);
    }
  }, [open]);

  const total = Math.max(0, subtotal - (promo?.discount || 0) - (points?.discount || 0));
  const cashNum = Number(cash) || 0;

  // Split payment (opsional). `legs` kosong = pembayaran tunggal -> perilaku lama.
  const split = legs.length > 0;
  const legAmount = (leg) => Number(leg?.amount) || 0;
  const legIndex = split ? Math.min(activeLeg, legs.length - 1) : 0;
  const currentLeg = split ? legs[legIndex] : null;
  const splitSum = legs.reduce((sum, leg) => sum + legAmount(leg), 0);
  const splitRemaining = total - splitSum;
  const splitSettled = isSplitSettled(total, legs);
  const allocated = splitSettled;

  const valid = split ? allocated : method !== "Cash" || cashNum >= total;
  const quickBase = split ? splitRemaining : total;
  const quick = [...new Set([quickBase, Math.ceil(quickBase / 10000) * 10000, Math.ceil(quickBase / 50000) * 50000, Math.ceil(quickBase / 100000) * 100000])].filter((v) => v > 0);
  const selectedMethod = split ? currentLeg?.method || method : method;
  const activeMethod = METHODS.find(({ id }) => id === selectedMethod) || METHODS[0];
  const ActiveMethodIcon = activeMethod.icon;

  const appendDigits = (digits) => {
    const next = (prev) => `${prev}${digits}`.replace(/^0+(?=\d)/, "").slice(0, 12);
    if (split) {
      if (!currentLeg) return;
      setLegs(legs.map((leg, i) => (i === legIndex ? { ...leg, amount: next(leg.amount || "") } : leg)));
      return;
    }
    setCash((prev) => next(prev));
  };

  const backspace = () => {
    if (split) {
      if (!currentLeg) return;
      setLegs(legs.map((leg, i) => (i === legIndex ? { ...leg, amount: (leg.amount || "").slice(0, -1) } : leg)));
      return;
    }
    setCash((prev) => prev.slice(0, -1));
  };

  const addLeg = () => {
    const next = appendSplitLeg(legs, method, cash);
    if (next === legs || next.length === legs.length) return;
    setLegs(next);
    setActiveLeg(next.length - 1);
  };

  const setLegMethod = (index, nextMethod) => {
    setLegs(legs.map((leg, i) => (i === index ? { ...leg, method: nextMethod } : leg)));
  };

  const removeLeg = (index) => {
    const next = legs.filter((_, i) => i !== index);
    if (next.length <= 1) {
      if (next[0]) {
        setMethod(next[0].method);
        setCash(next[0].amount || "");
      }
      setLegs([]);
      setActiveLeg(0);
      return;
    }
    setLegs(next);
    setActiveLeg(Math.min(activeLeg, next.length - 1));
  };

  const applyQuick = (value) => {
    if (split) {
      if (!currentLeg) return;
      setLegs(legs.map((leg, i) => (i === legIndex ? { ...leg, amount: String(value) } : leg)));
      return;
    }
    setCash(String(value));
  };

  const pickMethod = (id) => {
    if (split) {
      setLegMethod(legIndex, id);
      return;
    }
    setMethod(id);
  };

  const handleCashKeyDown = (e) => {
    if (/^\d$/.test(e.key)) {
      e.preventDefault();
      appendDigits(e.key);
    } else if (e.key === "Backspace") {
      e.preventDefault();
      backspace();
    } else if (e.key === "Enter" && valid && !busy) {
      e.preventDefault();
      pay();
    }
  };

  const authorize = async ({ pin: adminPin }) => {
    if (pinFor === "promo") {
      const { data } = await api.post("/discounts/promo", { code: promoCode, subtotal, adminPin });
      setPromo(data);
    } else {
      const { data } = await api.post("/discounts/points", { customerId, adminPin });
      setPoints(data);
    }
    setPin(adminPin);
    setPinFor(null);
  };

  const pay = () => {
    const extra = { promoCode: promo?.code || null, redeemPoints: !!points, discountPin: promo || points ? pin : null };
    if (!split) return onPay(method, method === "Cash" ? cashNum : total, extra);

    // Metode dominan dipakai untuk kolom `method` (CHECK constraint hanya menerima 4 metode).
    const args = splitPayArgs(total, legs, extra);
    return onPay(args.method, args.cashGiven, args.extra);
  };

  return (
    <>
      <Dialog open={open && !pinFor} onOpenChange={onOpenChange}>
        <DialogContent
          data-testid="pay-dialog"
          className="max-h-[92dvh] w-[calc(100vw-1.25rem)] max-w-[calc(100vw-1.25rem)] overflow-y-auto p-4 sm:p-5 md:max-w-3xl lg:max-w-5xl lg:p-6">
          <DialogHeader><DialogTitle>Pembayaran</DialogTitle></DialogHeader>
          <div className="grid gap-5 md:grid-cols-2 md:items-start md:gap-6">
            {/* Kolom kiri: ringkasan tagihan, metode pembayaran, diskon */}
            <div className="space-y-4">
              <div data-testid="pay-summary" className="space-y-1.5 rounded-xl bg-secondary p-4">
                <Line label="Subtotal" value={rp(subtotal)} testid="pay-subtotal" />
                {promo && <Line label={`Promo ${promo.code}`} value={`− ${rp(promo.discount)}`} tone="text-emerald-600" testid="pay-promo-discount" onRemove={() => setPromo(null)} />}
                {points && <Line label={`Tukar ${points.pointsRequired} poin`} value={`− ${rp(points.discount)}`} tone="text-emerald-600" testid="pay-points-discount" onRemove={() => setPoints(null)} />}
                <div className="flex items-baseline justify-between border-t border-border pt-2">
                  <span className="text-xs uppercase tracking-widest text-muted-foreground">Total bayar</span>
                  <span data-testid="pay-total" className="font-mono text-3xl font-bold text-primary">{rp(total)}</span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {split ? "Rincian metode bayar" : "Metode pembayaran"}
                  </p>
                  <button type="button" data-testid="pay-split-add" onClick={addLeg} disabled={legs.length >= METHODS.length}
                    className="flex h-8 touch-manipulation items-center gap-1 rounded-lg border border-dashed border-primary/60 px-2.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/10 disabled:opacity-40">
                    <Plus className="h-3.5 w-3.5" />Tambah Metode Bayar
                  </button>
                </div>
                {!split && (
                  <div className="grid grid-cols-4 gap-2">
                    {METHODS.map(({ id, icon: Icon }) => (
                      <button type="button" key={id} data-testid={`pay-method-${id.toLowerCase()}`} onClick={() => pickMethod(id)}
                        className={`flex min-h-[4.5rem] touch-manipulation flex-col items-center justify-center gap-1.5 rounded-xl border py-3 text-xs font-medium transition-colors ${method === id ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"}`}>
                        <Icon className="h-5 w-5" />{id}
                      </button>
                    ))}
                  </div>
                )}
                {split && (
                  <div data-testid="pay-split-legs" className="space-y-2">
                    {legs.map((leg, index) => {
                      const LegIcon = (METHODS.find(({ id }) => id === leg.method) || METHODS[0]).icon;
                      const isActive = index === legIndex;
                      return (
                        <div key={index} data-testid={`pay-split-leg-${index}`} onClick={() => setActiveLeg(index)}
                          className={`space-y-2 rounded-xl border p-2.5 transition-colors ${isActive ? "border-primary bg-primary/5" : "border-border"}`}>
                          <div className="flex items-center gap-2">
                            <LegIcon className="h-4 w-4 shrink-0 text-primary" />
                            <div className="grid min-w-0 flex-1 grid-cols-4 gap-1">
                              {METHODS.map(({ id }) => (
                                <button type="button" key={id} data-testid={`pay-split-leg-${index}-method-${id.toLowerCase()}`} onClick={() => setLegMethod(index, id)}
                                  className={`h-9 touch-manipulation rounded-lg border text-xs font-semibold transition-colors ${leg.method === id ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"}`}>
                                  {id}
                                </button>
                              ))}
                            </div>
                            <button type="button" data-testid={`pay-split-leg-${index}-remove`} onClick={() => removeLeg(index)} aria-label="Hapus metode"
                              className="flex h-9 w-9 shrink-0 touch-manipulation items-center justify-center rounded-lg border border-border text-muted-foreground hover:border-destructive hover:text-destructive">
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs text-muted-foreground">Nominal</span>
                            <span data-testid={`pay-split-leg-${index}-amount`} className={`font-mono text-lg font-semibold ${isActive ? "text-primary" : ""}`}>
                              {legAmount(leg) > 0 ? rp(legAmount(leg)) : "—"}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                    <div className="flex items-center justify-between rounded-xl bg-secondary/60 px-3 py-2 text-sm">
                      <span className="text-muted-foreground">Sisa belum dialokasikan</span>
                      <span data-testid="pay-split-remaining" className={`font-mono font-semibold ${splitSettled ? "text-emerald-600" : "text-destructive"}`}>
                        {rp(Math.max(0, splitRemaining))}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <DiscountArea promoCode={promoCode} setPromoCode={setPromoCode} customerId={customerId} hasPromo={!!promo} hasPoints={!!points}
                onPromo={() => setPinFor("promo")} onPoints={() => setPinFor("points")} />
            </div>

            {/* Kolom kanan: area input/keypad angka */}
            <div className="space-y-3 md:border-l md:border-border md:pl-6">
              {split || method === "Cash" ? (
                <>
                  <label htmlFor="pay-cash-input" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {split ? `Nominal ${selectedMethod}` : "Uang diterima"}
                  </label>
                  <div tabIndex={0} onKeyDown={handleCashKeyDown} className="rounded-xl outline-none focus-within:border-primary">
                    <input id="pay-cash-input" data-testid="pay-cash-input" type="text" inputMode="none" readOnly value={split ? currentLeg?.amount || "" : cash}
                      placeholder="Uang diterima"
                      className="h-14 w-full cursor-pointer rounded-xl border border-border bg-transparent px-4 text-right font-mono text-2xl font-semibold outline-none" />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {quick.map((v, i) => (
                      <button type="button" key={v} data-testid={`pay-quick-${i}`} onClick={() => applyQuick(v)} className="touch-manipulation rounded-lg border border-border px-3 py-2 font-mono text-xs hover:border-primary">
                        {i === 0 ? (split ? "Sisa penuh" : "Uang pas") : rp(v)}
                      </button>
                    ))}
                  </div>
                  <div data-testid="pay-numpad" className="grid grid-cols-3 gap-2">
                    {NUMPAD_KEYS.map((key) => (
                      key === "back" ? (
                        <button type="button" key={key} data-testid="pay-numpad-backspace" onClick={backspace}
                          aria-label="Hapus"
                          className="flex h-14 touch-manipulation items-center justify-center rounded-xl border border-border bg-white text-muted-foreground transition-colors active:bg-primary/10">
                          <Delete className="h-5 w-5" />
                        </button>
                      ) : (
                        <button type="button" key={key} data-testid={`pay-numpad-${key}`} onClick={() => appendDigits(key)}
                          className="h-14 touch-manipulation rounded-xl border border-border bg-white font-mono text-xl font-semibold transition-colors active:bg-primary/10">
                          {key}
                        </button>
                      )
                    ))}
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-secondary/60 px-4 py-3 text-sm">
                    <span className="text-muted-foreground">{split ? "Sisa belum dialokasikan" : "Kembalian"}</span>
                    {split ? (
                      <span data-testid="pay-change" className={`font-mono text-lg font-semibold ${splitSettled ? "text-emerald-600" : "text-destructive"}`}>
                        {splitSettled ? "Pas" : rp(Math.max(0, splitRemaining))}
                      </span>
                    ) : (
                      <span data-testid="pay-change" className={`font-mono text-lg font-semibold ${cashNum >= total ? "text-emerald-600" : "text-destructive"}`}>
                        {cashNum >= total ? rp(cashNum - total) : "Uang kurang"}
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex h-full min-h-[16rem] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-secondary/40 p-6 text-center">
                  <ActiveMethodIcon className="h-10 w-10 text-primary" />
                  <p className="text-sm text-muted-foreground">
                    Bayar penuh dengan <span className="font-semibold text-foreground">{method}</span>
                  </p>
                  <p className="font-mono text-3xl font-bold text-primary">{rp(total)}</p>
                </div>
              )}
            </div>
          </div>

          <button type="button" data-testid="pay-confirm-button" disabled={!valid || busy} onClick={pay}
            className="h-14 w-full touch-manipulation rounded-xl bg-primary text-base font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40">
            {busy ? "Memproses..." : "Selesaikan Pembayaran"}
          </button>
        </DialogContent>
      </Dialog>
      <AdminPinDialog open={!!pinFor} onClose={() => setPinFor(null)} testid="discount-pin" needPin
        title={pinFor === "promo" ? `Otorisasi Kode Promo ${promoCode}` : "Otorisasi Tukar Poin"}
        description="Masukkan PIN admin untuk menerapkan diskon." onSubmit={authorize} />
    </>
  );
};
