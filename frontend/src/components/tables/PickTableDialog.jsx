import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Armchair } from "lucide-react";
import { STATUS } from "@/components/tables/FloorCanvas";
import { rp } from "@/lib/api";

export const PickTableDialog = ({ open, onClose, title, options, onPick, testid }) => (
  <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
    <DialogContent data-testid={`${testid}-dialog`} className="max-h-[85vh] overflow-y-auto sm:max-w-[600px]">
      <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
      {options.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Tidak ada meja yang bisa dipilih.</p>
      ) : (
        <div className="grid grid-cols-3 gap-3 md:grid-cols-4">
          {options.map((t) => (
            <button
              key={t.id}
              data-testid={`${testid}-option-${t.id}`}
              onClick={() => onPick(t)}
              className={`min-h-[96px] rounded-2xl border border-border bg-secondary/50 p-3 text-center transition-colors hover:border-primary ${STATUS[t.status]?.text}`}
            >
              <Armchair className="mx-auto h-5 w-5" />
              <p className="mt-1 text-xs font-bold">{t.name}</p>
              <p className="text-[10px] text-muted-foreground">{t.status === "occupied" ? rp(t.orderData?.total) : t.area}</p>
            </button>
          ))}
        </div>
      )}
    </DialogContent>
  </Dialog>
);
