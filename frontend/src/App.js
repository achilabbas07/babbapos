import "@/App.css";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { FINANCE_NAV, NAV } from "@/lib/nav";
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
import FinanceAccounts from "@/pages/finance/FinanceAccounts";
import FinanceDashboard from "@/pages/finance/FinanceDashboard";
import ProfitAndLoss from "@/pages/finance/ProfitAndLoss";
import CashFlowStatement from "@/pages/finance/CashFlowStatement";
import { toast } from "sonner";

const PAGES = {
  "/pos": POS, "/tables": Tables, "/open-bills": OpenBills, "/transactions": Transactions, "/customers": Customers,
  "/products": Products, "/inventory": Inventory, "/purchases": Purchases, "/expenses": Expenses, "/reports": Reports,
  "/users": Users, "/cash": Cash, "/shifts": Shifts, "/targets": Targets, "/profile": Profile,
  "/admin/jurnal": Journal, "/admin/daftar-akun": FinanceAccounts, "/admin/dashboard-keuangan": FinanceDashboard, "/admin/laba-rugi": ProfitAndLoss,
  "/admin/arus-kas": CashFlowStatement,
};

const Protected = ({ roles, deniedMessage, children }) => {
  const { user } = useAuth();
  const denied = Boolean(user && roles && !roles.includes(user.role));
  useEffect(() => {
    if (denied && deniedMessage) toast.error(deniedMessage);
  }, [denied, deniedMessage]);
  if (user === null) return <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Memuat...</div>;
  if (!user) return <Navigate to="/login" replace />;
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
            {[...NAV, ...FINANCE_NAV].map(({ to, roles }) => {
              const Page = PAGES[to];
              const isFinanceRoute = FINANCE_NAV.some((item) => item.to === to);
              return <Route key={to} path={to} element={<Protected roles={roles} deniedMessage={isFinanceRoute ? "Akses Ditolak" : undefined}><Page /></Protected>} />;
            })}
          </Route>
          <Route path="*" element={<Navigate to="/pos" replace />} />
        </Routes>
      </BrowserRouter>
      </ProfileProvider>
      <Toaster theme="light" position="top-right" richColors />
    </AuthProvider>
  );
}

export default App;
