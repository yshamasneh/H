import { useTranslation } from "react-i18next";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { Layout } from "./components/Layout";
import { AuditLogPage } from "./pages/AuditLogPage";
import { DashboardPage } from "./pages/DashboardPage";
import { DriversPage } from "./pages/DriversPage";
import { LoginPage } from "./pages/LoginPage";
import { OrderDetailPage } from "./pages/OrderDetailPage";
import { OrdersPage } from "./pages/OrdersPage";
import { RestaurantDetailPage } from "./pages/RestaurantDetailPage";
import { RestaurantsPage } from "./pages/RestaurantsPage";
import { UsersPage } from "./pages/UsersPage";

export default function App() {
  const { t } = useTranslation();
  const { user, isBooting } = useAuth();

  if (isBooting) {
    return <div className="loading-state" style={{ paddingTop: 40 }}>{t("common.loading")}</div>;
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <Layout>
      <Routes>
        <Route element={<DashboardPage />} path="/" />
        <Route element={<RestaurantsPage />} path="/restaurants" />
        <Route element={<RestaurantDetailPage />} path="/restaurants/:restaurantId" />
        <Route element={<OrdersPage />} path="/orders" />
        <Route element={<OrderDetailPage />} path="/orders/:orderId" />
        <Route element={<DriversPage />} path="/drivers" />
        <Route element={<UsersPage />} path="/users" />
        <Route element={<AuditLogPage />} path="/audit-log" />
        <Route element={<Navigate replace to="/" />} path="*" />
      </Routes>
    </Layout>
  );
}
