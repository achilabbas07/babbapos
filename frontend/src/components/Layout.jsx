import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { ChevronDown, LogOut, Maximize, Minimize, Settings } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useProfile } from "@/context/ProfileContext";
import { toast } from "sonner";
import { BrandLogo } from "@/components/BrandLogo";
import { NAV_GROUPS, filterNavItemsByRole } from "@/lib/nav";
import { ROLE_LABEL } from "@/lib/api";
import { ShiftGate } from "@/components/ShiftGate";
import { WaiterPrinterButton } from "@/components/WaiterPrinterButton";
import { PrinterMappingDialog } from "@/components/settings/PrinterMappingDialog";

const Clock = () => {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span data-testid="header-clock" className="font-mono text-sm text-muted-foreground tabular-nums">
      {now.toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short" })} · {now.toLocaleTimeString("id-ID")}
    </span>
  );
};

const FullscreenButton = () => {
  const [isFull, setIsFull] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFull(Boolean(
      document.fullscreenElement
      || document.webkitFullscreenElement
      || document.body.classList.contains("app-fullscreen-fallback"),
    ));
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    onChange();
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);
  const toggle = async () => {
    const fallbackActive = document.body.classList.contains("app-fullscreen-fallback");
    if (fallbackActive) {
      document.body.classList.remove("app-fullscreen-fallback");
      setIsFull(false);
      return;
    }

    const activateInPageFullscreen = () => {
      document.body.classList.add("app-fullscreen-fallback");
      setIsFull(true);
    };

    try {
      const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
      if (fullscreenElement) {
        const exitFullscreen = document.exitFullscreen || document.webkitExitFullscreen;
        if (!exitFullscreen) {
          activateInPageFullscreen();
          return;
        }
        await exitFullscreen.call(document);
        return;
      }

      const root = document.documentElement;
      const requestFullscreen = root.requestFullscreen || root.webkitRequestFullscreen;
      if (!requestFullscreen) {
        activateInPageFullscreen();
        return;
      }
      await requestFullscreen.call(root);
    } catch (error) {
      activateInPageFullscreen();
      console.warn("Browser fullscreen was denied; using the in-page fallback.", error);
    }
  };
  const Icon = isFull ? Minimize : Maximize;
  return (
    <button
      data-testid="fullscreen-toggle-button"
      type="button"
      onClick={toggle}
      title={isFull ? "Keluar layar penuh" : "Layar penuh"}
      className="grid h-10 w-10 touch-manipulation place-items-center rounded-xl border border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
};

const Brand = ({ rail }) => {
  const { profile, appName } = useProfile();
  return (
    <div className={`flex min-w-0 items-center gap-2.5 ${rail ? "md:justify-center 2xl:justify-start" : ""}`}>
      <BrandLogo url={profile.logo_url} testid={rail ? "brand-logo" : "brand-logo-mobile"} />
      <div className={`min-w-0 leading-tight ${rail ? "md:hidden 2xl:block" : ""}`}>
        <p data-testid={rail ? "brand-name" : "brand-name-mobile"} className="max-w-[160px] truncate font-bold tracking-tight">{appName}</p>
        <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">F&amp;B System</p>
      </div>
    </div>
  );
};

const NavItem = ({ to, label, icon: Icon, prefix, nested = false }) => (
  <NavLink
    to={to}
    data-testid={`${prefix}-${to.slice(1)}`}
    className={({ isActive }) =>
      `flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-200 ${
        prefix === "nav" ? "md:flex-col md:gap-1 md:px-1 md:py-2 md:text-center md:text-[10px] md:leading-tight 2xl:flex-row 2xl:gap-3 2xl:px-3 2xl:py-2.5 2xl:text-left 2xl:text-sm" : ""
      } ${nested ? "2xl:pl-6" : ""} ${
        isActive ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
      }`
    }
  >
    <Icon className={`h-4 w-4 shrink-0 ${prefix === "nav" ? "md:h-5 md:w-5 2xl:h-4 2xl:w-4" : ""}`} />
    <span>{label}</span>
  </NavLink>
);

// Wadah utama sub-menu (mis. "Laporan & Analisa Operasional"): label induk +
// sub-menu bertingkat di bawahnya (mis. "Laporan Penjualan Produk").
const NavNestedGroup = ({ node }) => {
  const Icon = node.icon;
  return (
    <div data-testid={`nav-nested-${node.id}`}>
      <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-foreground/80">
        <Icon className="h-4 w-4 shrink-0" />
        <span className="truncate">{node.label}</span>
      </div>
      <div className="mt-0.5 space-y-1 border-l border-border/60 pl-2">
        {node.items.map((n) => <NavItem key={n.to} {...n} prefix="nav" nested />)}
      </div>
    </div>
  );
};

// Mengubah item bertingkat menjadi daftar datar (dipakai rail mode & nav mobile).
const flattenNavItems = (items) => (items || []).flatMap((n) => (n.items ? flattenNavItems(n.items) : [n]));

const NavGroup = ({ group, open, onToggle, role }) => {
  const items = filterNavItemsByRole(group.items, role);
  if (items.length === 0) return null;
  const expanded = group.alwaysOpen || open;
  return (
    <section data-testid={`nav-group-${group.id}`} className="pt-3 first:pt-0">
      <button
        type="button"
        data-testid={`nav-group-toggle-${group.id}`}
        onClick={() => !group.alwaysOpen && onToggle(group.id)}
        aria-expanded={expanded}
        aria-controls={`nav-group-panel-${group.id}`}
        aria-disabled={group.alwaysOpen || undefined}
        className={`mb-1 flex w-full items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground transition-colors ${
          group.alwaysOpen ? "cursor-default" : "hover:text-foreground"
        }`}
      >
        <span className="truncate">{group.label}</span>
        <ChevronDown
          aria-hidden="true"
          className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${
            expanded ? "rotate-180" : ""
          } ${group.alwaysOpen ? "opacity-40" : ""}`}
        />
      </button>
      {expanded && (
        <div id={`nav-group-panel-${group.id}`} className="space-y-1">
          {items.map((n) => (n.items
            ? <NavNestedGroup key={n.id} node={n} />
            : <NavItem key={n.to} {...n} prefix="nav" nested />))}
        </div>
      )}
    </section>
  );
};

const GROUPS_STORAGE_KEY = "babbapos.nav.groups";
const DEFAULT_OPEN_GROUPS = { operasional: true, inventaris: false, keuangan: false, manajemen: false };

const readOpenGroups = () => {
  try {
    const raw = window.localStorage.getItem(GROUPS_STORAGE_KEY);
    if (raw) return { ...DEFAULT_OPEN_GROUPS, ...JSON.parse(raw) };
  } catch {
    // Ignore unreadable/corrupt storage and fall back to defaults.
  }
  return DEFAULT_OPEN_GROUPS;
};

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [openGroups, setOpenGroups] = useState(readOpenGroups);
  const [printerOpen, setPrinterOpen] = useState(false);

  const visibleGroups = NAV_GROUPS
    .map((group) => ({ ...group, items: filterNavItemsByRole(group.items, user.role) }))
    .filter((group) => group.items.length > 0);
  const flatItems = visibleGroups.flatMap((group) => flattenNavItems(group.items));

  const toggleGroup = (id) => setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }));

  useEffect(() => {
    try {
      window.localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(openGroups));
    } catch {
      // Persisting the accordion state is a nice-to-have; ignore quota/privacy errors.
    }
  }, [openGroups]);

  // Keep the active route discoverable: expand its group when navigating into it.
  useEffect(() => {
    const activeGroup = NAV_GROUPS.find(
      (group) => !group.alwaysOpen && flattenNavItems(group.items).some((n) => n.to === location.pathname),
    );
    if (!activeGroup) return;
    setOpenGroups((prev) => (prev[activeGroup.id] ? prev : { ...prev, [activeGroup.id]: true }));
  }, [location.pathname]);

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      toast.error(error.message || "Gagal mengakhiri sesi.");
    }
  };
  return (
    <div className="min-h-screen md:flex">
      <aside className="sticky top-0 hidden h-screen w-[88px] shrink-0 flex-col border-r border-border bg-card md:flex 2xl:w-64 print:hidden">
        <div className="px-3 py-4 2xl:px-5 2xl:py-5"><Brand rail /></div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-2 pb-6 2xl:px-3">
          {/* Rail mode (md–2xl): icon-only list, groups separated by dividers. */}
          <div className="2xl:hidden">
            {visibleGroups.map((group, index) => (
              <div key={group.id} className={index > 0 ? "mt-2 border-t border-border/60 pt-2" : ""}>
                {flattenNavItems(group.items).map((n) => <NavItem key={n.to} {...n} prefix="nav" />)}
              </div>
            ))}
          </div>
          {/* Full sidebar (2xl+): collapsible accordion sections. */}
          <div className="hidden 2xl:block">
            {visibleGroups.map((group) => (
              <NavGroup
                key={group.id}
                group={group}
                open={Boolean(openGroups[group.id])}
                onToggle={toggleGroup}
                role={user.role}
              />
            ))}
          </div>
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass sticky top-0 z-30 border-b border-border print:hidden">
          <div className="flex h-16 items-center justify-between gap-4 px-4 lg:px-6">
            <div className="md:hidden"><Brand /></div>
            <div className="hidden sm:block"><Clock /></div>
            <div className="flex items-center gap-3">
              {user.role === "waiter" && <WaiterPrinterButton />}
              <button
                data-testid="printer-settings-button"
                type="button"
                onClick={() => setPrinterOpen(true)}
                title="Pengaturan Printer (Dapur & Kasir)"
                className="grid h-10 w-10 touch-manipulation place-items-center rounded-xl border border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              >
                <Settings className="h-4 w-4" />
              </button>
              <FullscreenButton />
              <div className="text-right leading-tight">
                <p data-testid="header-user-name" className="text-sm font-semibold">{user.name}</p>
                <p data-testid="header-user-role" className="text-[11px] uppercase tracking-widest text-primary">{ROLE_LABEL[user.role]}</p>
              </div>
              <button
                data-testid="logout-button"
                onClick={handleLogout}
                className="grid h-10 w-10 place-items-center rounded-xl border border-border text-muted-foreground transition-colors hover:border-destructive hover:text-destructive"
                title="Keluar"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-3 pb-2 md:hidden">
            {flatItems.map((n) => <NavItem key={n.to} {...n} prefix="mobile-nav" />)}
          </nav>
        </header>
        <main className="min-w-0 flex-1 px-3 py-4 sm:px-5 lg:px-6">
          <ShiftGate><Outlet /></ShiftGate>
        </main>
      </div>
      <PrinterMappingDialog open={printerOpen} onClose={() => setPrinterOpen(false)} />
    </div>
  );
}
