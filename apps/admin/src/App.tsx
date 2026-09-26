import { useTranslation } from "react-i18next";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { Layout } from "./components/Layout";
import { AuditLogPage } from "./pages/AuditLogPage";
import { BusinessOrderPage } from "./pages/business/BusinessOrderPage";
import { BusinessReportsPage } from "./pages/business/BusinessReportsPage";
import { BusinessSettingsPage } from "./pages/business/BusinessSettingsPage";
import { CataloguePage } from "./pages/business/CataloguePage";
import { InventoryPage } from "./pages/business/InventoryPage";
import { LiveOrdersPage } from "./pages/business/LiveOrdersPage";
import { StaffPage } from "./pages/business/StaffPage";
import { DashboardPage } from "./pages/DashboardPage";
import { DriversPage } from "./pages/DriversPage";
import { LandmarksPage } from "./pages/LandmarksPage";
import { LiveDriversPage } from "./pages/LiveDriversPage";
import { LoginPage } from "./pages/LoginPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { OrderDetailPage } from "./pages/OrderDetailPage";
import { OrdersPage } from "./pages/OrdersPage";
import { RestaurantDetailPage } from "./pages/RestaurantDetailPage";
import { RestaurantsPage } from "./pages/RestaurantsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { UsersPage } from "./pages/UsersPage";
import { AccountingPage } from "./pages/AccountingPage";
import { OffersPage } from "./pages/OffersPage";
import { OperatingCostsPage } from "./pages/business/OperatingCostsPage";

export default function App() {
  const { t } = useTranslation();
  const { user, isBooting } = useAuth();

  if (isBooting) {
    return <div className="loading-state" style={{ paddingTop: 40 }}>{t("common.loading")}</div>;
  }

  if (!user) {
    return <LoginPage />;
  }

  // Two shells, one application: a business account operates its own store, a platform account
  // administers the platform. Which one you get follows from the account type.
  return <Layout>{user.role === "RESTAURANT" ? <BusinessRoutes /> : <PlatformRoutes />}</Layout>;
}

function BusinessRoutes() {
  return (
    <Routes>
      <Route element={<LiveOrdersPage />} path="/business" />
      <Route element={<BusinessOrderPage />} path="/business/orders/:orderId" />
      <Route element={<CataloguePage />} path="/business/catalogue" />
      <Route element={<InventoryPage />} path="/business/inventory" />
      <Route element={<OperatingCostsPage />} path="/business/operating-costs" />
      <Route element={<BusinessReportsPage />} path="/business/reports" />
      <Route element={<BusinessSettingsPage />} path="/business/settings" />
      <Route element={<StaffPage />} path="/business/staff" />
      <Route element={<Navigate replace to="/business" />} path="*" />
    </Routes>
  );
}

function PlatformRoutes() {
  return (
    <Routes>
      <Route element={<DashboardPage />} path="/" />
      <Route element={<RestaurantsPage />} path="/restaurants" />
      <Route element={<RestaurantDetailPage />} path="/restaurants/:restaurantId" />
      <Route element={<OrdersPage />} path="/orders" />
      <Route element={<OrderDetailPage />} path="/orders/:orderId" />
      <Route element={<DriversPage />} path="/drivers" />
      <Route element={<LiveDriversPage />} path="/drivers/live" />
      <Route element={<UsersPage />} path="/users" />
      <Route element={<LandmarksPage />} path="/landmarks" />
      <Route element={<OffersPage />} path="/offers" />
      <Route element={<NotificationsPage />} path="/notifications" />
      <Route element={<AccountingPage />} path="/accounting" />
      <Route element={<SettingsPage />} path="/settings" />
      <Route element={<AuditLogPage />} path="/audit-log" />
      <Route element={<Navigate replace to="/" />} path="*" />
    </Routes>
  );
}
