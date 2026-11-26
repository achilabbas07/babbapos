import "@/App.css";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { FINANCE_NAV, NAV, OPERATIONAL_NAV, OWNER_MODE_ALLOWED_PATHS, OWNER_NAV } from "@/lib/nav";
import { OWNER_HOME, isOwnerAccount, isOwnerMode } from "@/lib/appMode";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import POS from "@/pages/POS";
import Tables from "@/pages/Tables";
import OpenBills from "@/pages/OpenBills";
import Transactions from "@/pages/Transactions";
import Customers from "@/pages/Customers";
import Products from "@/pages/Products";
import Inventory from "@/pages/Inventory";
import Purchases from "@/pages/Purchases";
import Expenses from "@/pages/Expenses";
import Reports from "@/pages/Reports";
import Users from "@/pages/Users";
import Cash from "@/pages/Cash";
import Shifts from "@/pages/Shifts";
import Targets from "@/pages/Targets";
import Profile from "@/pages/Profile";
import { ProfileProvider } from "@/context/ProfileContext";
import Journal from "@/pages/finance/Journal";
import FinanceDashboard from "@/pages/finance/FinanceDashboard";
import ProfitAndLoss from "@/pages/finance/ProfitAndLoss";
import CashFlowStatement from "@/pages/finance/CashFlowStatement";
import PromoManagement from "@/pages/PromoManagement";
import PointRewardSettings from "@/pages/PointRewardSettings";
import COAManagement from "@/pages/COAManagement";
import ProductSalesReport from "@/pages/reports/ProductSalesReport";
import VoidSalesReport from "@/pages/reports/VoidSalesReport";
import WaiterSalesTargetReport from "@/pages/reports/WaiterSalesTargetReport";
import PointRewardReport from "@/pages/reports/PointRewardReport";
import CustomerBehaviorReport from "@/pages/reports/CustomerBehaviorReport";
import PromoReport from "@/pages/reports/PromoReport";
import Owner from "@/pages/Owner";
import { toast } from "sonner";

// Semua item menu yang punya route + halaman. Menu Mode Owner disertakan agar
// rute /owner tetap ada di kedua varian build (operasional & Owner).
const ALL_NAV_ITEMS = [...NAV, ...FINANCE_NAV, ...OPERATIONAL_NAV, ...OWNER_NAV];

const PAGES = {
  "/pos": POS, "/tables": Tables, "/open-bills": OpenBills, "/transactions": Transactions, "/customers": Customers,
  "/products": Products, "/inventory": Inventory, "/purchases": Purchases, "/expenses": Expenses, "/reports": Reports,
  "/users": Users, "/cash": Cash, "/shifts": Shifts, "/targets": Targets, "/profile": Profile,
  "/admin/jurnal": Journal, "/admin/dashboard-keuangan": FinanceDashboard, "/admin/laba-rugi": ProfitAndLoss,
  "/admin/arus-kas": CashFlowStatement,
  "/coa": COAManagement,
  "/promos": PromoManagement,
  "/point-reward-settings": PointRewardSettings,
  "/reports/product-sales": ProductSalesReport,
  "/reports/void-sales": VoidSalesReport,
  "/reports/waiter-sales-target": WaiterSalesTargetReport,
  "/reports/point-reward": PointRewardReport,
  "/reports/customer-behavior": CustomerBehaviorReport,
  "/reports/promo": PromoReport,
  "/owner": Owner,
};

// Layar penolakan khusus APK Owner: akun selain pemilik (peran admin) tidak
// diberi akses ke apa pun. Disajikan sebagai halaman, bukan pengalihan, supaya
// tidak ada halaman operasional yang sempat dirender / berputar-putar.
const OwnerModeBlocked = () => {
  const { logout } = useAuth();
  return (
    <div className="grid min-h-dvh place-items-center px-6 text-center">
      <div className="max-w-md space-y-3" data-testid="owner-mode-blocked">
        <p className="text-lg font-semibold">Aplikasi ini hanya untuk Pemilik</p>
        <p className="text-sm text-muted-foreground">
          Aplikasi Mode Owner hanya menampilkan pantauan baca-saja untuk akun pemilik.
          Akun ini tidak memiliki akses. Silakan masuk memakai akun pemilik, atau
          gunakan aplikasi POS operasional.
        </p>
        <button
          type="button"
          data-testid="owner-mode-blocked-logout"
          onClick={() => { Promise.resolve(logout()).catch(() => {}); }}
          className="inline-flex h-10 items-center rounded-lg border border-border px-4 text-sm"
        >
          Keluar
        </button>
      </div>
    </div>
  );
};

const Protected = ({ roles, deniedMessage, children }) => {
  const { user } = useAuth();
  const location = useLocation();
  const ownerMode = isOwnerMode();
  const denied = Boolean(user && roles && !roles.includes(user.role));
  // Isolasi ketat APK Owner: hanya akun pemilik (peran admin) yang boleh masuk,
  // dan hanya rute baca-saja. Rute lain dikembalikan ke Pantauan Pemilik.
  const ownerBlocked = ownerMode && user && !isOwnerAccount(user);
  const ownerOffLimits = ownerMode
    && isOwnerAccount(user)
    && !OWNER_MODE_ALLOWED_PATHS.includes(location.pathname);
  useEffect(() => {
    if (denied && deniedMessage) toast.error(deniedMessage);
  }, [denied, deniedMessage]);
  if (user === null) return <div className="grid min-h-dvh place-items-center text-sm text-muted-foreground">Memuat...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (ownerBlocked) return <OwnerModeBlocked />;
  if (ownerOffLimits) return <Navigate to={OWNER_HOME} replace />;
  if (denied) return <Navigate to="/pos" replace />;
  return children;
};

function App() {
  return (
    <AuthProvider>
      <ProfileProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Protected><Layout /></Protected>}>
            {ALL_NAV_ITEMS.map(({ to, roles }) => {
              const Page = PAGES[to];
              const isFinanceRoute = [...FINANCE_NAV, ...OPERATIONAL_NAV].some((item) => item.to === to);
              return <Route key={to} path={to} element={<Protected roles={roles} deniedMessage={isFinanceRoute ? "Akses Ditolak" : undefined}><Page /></Protected>} />;
            })}
          </Route>
          <Route path="*" element={<Navigate to={isOwnerMode() ? OWNER_HOME : "/pos"} replace />} />
        </Routes>
      </BrowserRouter>
      </ProfileProvider>
      <Toaster theme="light" position="top-right" richColors />
    </AuthProvider>
  );
}

export default App;
