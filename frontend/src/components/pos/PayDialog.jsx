import { useEffect, useState } from "react";
import { Banknote, QrCode, CreditCard, Landmark, TicketPercent, Gift, X, Delete } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AdminPinDialog } from "@/components/tables/AdminPinDialog";
import { api, rp } from "@/lib/api";

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

  useEffect(() => {
    if (open) {
      setMethod("Cash");
      setCash("");
      setPromoCode("");
      setPromo(null);
      setPoints(null);
      setPin(null);
    }
  }, [open]);

  const total = Math.max(0, subtotal - (promo?.discount || 0) - (points?.discount || 0));
  const cashNum = Number(cash) || 0;
  const valid = method !== "Cash" || cashNum >= total;
  const quick = [...new Set([total, Math.ceil(total / 10000) * 10000, Math.ceil(total / 50000) * 50000, Math.ceil(total / 100000) * 100000])].filter((v) => v > 0);

  const appendDigits = (digits) => {
    setCash((prev) => `${prev}${digits}`.replace(/^0+(?=\d)/, "").slice(0, 12));
  };

  const backspace = () => setCash((prev) => prev.slice(0, -1));

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

  const pay = () => onPay(method, method === "Cash" ? cashNum : total, {
    promoCode: promo?.code || null, redeemPoints: !!points, discountPin: promo || points ? pin : null,
  });

  return (
    <>
      <Dialog open={open && !pinFor} onOpenChange={onOpenChange}>
        <DialogContent data-testid="pay-dialog" className="max-h-[94vh] overflow-y-auto sm:max-w-md">
          <DialogHeader><DialogTitle>Pembayaran</DialogTitle></DialogHeader>
          <div data-testid="pay-summary" className="space-y-1.5 rounded-xl bg-secondary p-4">
            <Line label="Subtotal" value={rp(subtotal)} testid="pay-subtotal" />
            {promo && <Line label={`Promo ${promo.code}`} value={`− ${rp(promo.discount)}`} tone="text-emerald-600" testid="pay-promo-discount" onRemove={() => setPromo(null)} />}
            {points && <Line label={`Tukar ${points.pointsRequired} poin`} value={`− ${rp(points.discount)}`} tone="text-emerald-600" testid="pay-points-discount" onRemove={() => setPoints(null)} />}
            <div className="flex items-baseline justify-between border-t border-border pt-2">
              <span className="text-xs uppercase tracking-widest text-muted-foreground">Total bayar</span>
              <span data-testid="pay-total" className="font-mono text-3xl font-bold text-primary">{rp(total)}</span>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {METHODS.map(({ id, icon: Icon }) => (
              <button type="button" key={id} data-testid={`pay-method-${id.toLowerCase()}`} onClick={() => setMethod(id)}
                className={`flex flex-col items-center gap-1.5 rounded-xl border py-3 text-xs font-medium transition-colors ${method === id ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"}`}>
                <Icon className="h-5 w-5" />{id}
              </button>
            ))}
          </div>
          {method === "Cash" && (
            <div className="space-y-3">
              <label htmlFor="pay-cash-input" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Uang diterima</label>
              <div tabIndex={0} onKeyDown={handleCashKeyDown} className="rounded-xl outline-none focus-within:border-primary">
                <input id="pay-cash-input" data-testid="pay-cash-input" type="text" inputMode="none" readOnly value={cash}
                  placeholder="Uang diterima"
                  className="h-14 w-full cursor-pointer rounded-xl border border-border bg-transparent px-4 font-mono text-2xl font-semibold outline-none" />
              </div>
              <div className="flex flex-wrap gap-2">
                {quick.map((v, i) => (
                  <button type="button" key={v} data-testid={`pay-quick-${i}`} onClick={() => setCash(String(v))} className="touch-manipulation rounded-lg border border-border px-3 py-1.5 font-mono text-xs hover:border-primary">
                    {i === 0 ? "Uang pas" : rp(v)}
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
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Kembalian</span>
                <span data-testid="pay-change" className={`font-mono font-semibold ${cashNum >= total ? "text-emerald-600" : "text-destructive"}`}>
                  {cashNum >= total ? rp(cashNum - total) : "Uang kurang"}
                </span>
              </div>
            </div>
          )}
          <DiscountArea promoCode={promoCode} setPromoCode={setPromoCode} customerId={customerId} hasPromo={!!promo} hasPoints={!!points}
            onPromo={() => setPinFor("promo")} onPoints={() => setPinFor("points")} />
          <button type="button" data-testid="pay-confirm-button" disabled={!valid || busy} onClick={pay}
            className="h-12 w-full touch-manipulation rounded-xl bg-primary font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40">
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
