import { Target } from "lucide-react";
import {
  formatProgressValue,
  isAchieved,
  progressCaption,
  targetTypeOf,
  targetValueOf,
  TARGET_TYPE_REVENUE,
  TARGET_TYPE_TIME,
} from "@/lib/targetTypes";

const tone = (pct) => (pct >= 100 ? "bg-emerald-500" : pct >= 50 ? "bg-blue-500" : "bg-amber-500");

const typeChip = (item) => {
  const type = targetTypeOf(item);
  if (type === TARGET_TYPE_REVENUE) return "Omzet";
  if (type === TARGET_TYPE_TIME) return "Waktu";
  return "";
};

export const TargetBar = ({ item, testid }) => (
  <div data-testid={testid}>
    <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
      <span className="flex min-w-0 items-center gap-1.5 font-medium">
        <Target className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="truncate">{item.name}</span>
        {typeChip(item) && <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">{typeChip(item)}</span>}
      </span>
      <span className="shrink-0 whitespace-nowrap font-mono text-xs">
        <span className="text-base font-bold text-foreground">{formatProgressValue(item, item.achieved)}</span>
        <span className="text-muted-foreground"> / {formatProgressValue(item, targetValueOf(item))}</span>
        {isAchieved(item) && <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">TERCAPAI</span>}
      </span>
    </div>
    <div className="h-2.5 overflow-hidden rounded-full bg-secondary">
      <div className={`h-full rounded-full transition-[width] duration-500 ${tone(item.pct)}`} style={{ width: `${item.pct}%` }} />
    </div>
    {progressCaption(item) && <p className="mt-1 text-[11px] text-muted-foreground">{progressCaption(item)}</p>}
    {item.breakdown?.length > 1 && (
      <p className="mt-1 text-[11px] text-muted-foreground">{item.breakdown.map((b) => `${b.productName} ${b.qty}`).join(" · ")}</p>
    )}
  </div>
);

export const ProgressCard = ({ p, children }) => (
  <div data-testid={`target-progress-${p.waiterId}`} className="h-full min-w-0 rounded-2xl border border-border bg-card p-5 shadow-sm">
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <p className="font-semibold">{p.waiterName}</p>
        <p className="font-mono text-xs text-muted-foreground">{p.shiftId} · mulai {new Date(p.openedAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</p>
      </div>
      {children}
    </div>
    {p.items.length === 0 ? <p className="text-sm text-muted-foreground">Belum ada target yang berlaku.</p> : (
      <div className="space-y-4">{p.items.map((i) => <TargetBar key={i.targetId} item={i} testid={`target-bar-${p.waiterId}-${i.targetId}`} />)}</div>
    )}
  </div>
);
