import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  Image,
  StatusBar,
  StyleSheet,
  Platform,
  View
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import i18n, { resolveInitialLanguage } from "./src/i18n";
import { reconcileRTL, reloadApp } from "./src/i18n/rtl";
import {
  fetchCurrentUser,
  logout,
  refreshSession,
  type AuthResult,
  type MenuItemSummary,
  type RestaurantSummary
} from "./src/core/api";
import {
  ForgotPasswordScreen,
  HomeScreen,
  LoginScreen,
  NewPasswordScreen,
  OtpScreen,
  SignupScreen
} from "./src/features/auth/screens";
import {
  DriverRegistrationScreen,
  RestaurantRegistrationScreen
} from "./src/features/auth/role-registration-screens";
import {
  addCartItem,
  removeCartItem,
  setCartItemSubstitution,
  setCartItemQuantity,
  startCart,
  type Cart
} from "./src/features/customer/cart";
import {
  CartScreen,
  CheckoutScreen,
  OrderConfirmationScreen,
  OrderDetailScreen,
  OrderHistoryScreen
} from "./src/features/customer/cart-screens";
import {
  accountNotFoundToSignup,
  authResultToHome,
  forgotRequestToOtp,
  goToAdminAuditLog,
  goToAdminDashboard,
  goToAdminDrivers,
  goToAdminOrderDetail,
  goToAdminOrders,
  goToAdminOffers,
  goToAdminRestaurantDetail,
  goToAdminRestaurants,
  goToAdminUsers,
  goToAccount,
  goToCart,
  goToCheckout,
  goToDeliveryDetail,
  goToDriverHome,
  goToDriverSignup,
  goToLogin,
  goToNotifications,
  goToOrderDetail,
  goToOrderHistory,
  goToRestaurantManagement,
  goToRestaurantMenu,
  goToRestaurantOrderDetail,
  goToRestaurantOrders,
  goToRestaurantSignup,
  goToRestaurants,
  goToSupermarketCatalog,
  goToSupermarketProduct,
  goToSupermarkets,
  goToSignup,
  homeForUser,
  initialScreen,
  orderToConfirmation,
  resetOtpToNewPassword,
  signupRequestToOtp,
  type AppScreen
} from "./src/navigation/navigation";
import { DeliveryDetailScreen, DriverHomeScreen } from "./src/features/driver/screens";
import { NotificationInboxScreen } from "./src/features/shared/notification-screens";
import { RestaurantOrderDetailScreen, RestaurantOrdersScreen } from "./src/features/restaurant/order-screens";
import { RestaurantListScreen, RestaurantMenuScreen } from "./src/features/customer/restaurant-screens";
import { clearTokens, getAccessToken, getRefreshToken, saveTokens } from "./src/core/session";
import { disconnectSocket } from "./src/core/socket";
import { AdminDashboardScreen } from "./src/features/admin/dashboard-screen";
import { AdminRestaurantsScreen, AdminRestaurantDetailScreen } from "./src/features/admin/restaurants-screen";
import { AdminDriversScreen } from "./src/features/admin/drivers-screen";
import { AdminOrderDetailScreen, AdminOrdersScreen } from "./src/features/admin/orders-screen";
import { AdminUsersScreen } from "./src/features/admin/users-screen";
import { AdminAuditLogScreen } from "./src/features/admin/audit-log-screen";
import { AdminOffersScreen } from "./src/features/admin/offers-screen";
import { CustomerHomeScreen } from "./src/features/customer/home-screen";
import { AccountScreen } from "./src/features/customer/account-screen";
import { RestaurantManagementScreen } from "./src/features/restaurant/management-screen";
import {
  SupermarketCatalogScreen,
  SupermarketListScreen,
  SupermarketProductScreen
} from "./src/features/customer/supermarket-screens";

const splashDurationMs = 3000;
const logo = require("./assets/logo/jovo-wordmark.png");

export default function App() {
  return (
    <SafeAreaProvider>
      <TasawaQApp />
    </SafeAreaProvider>
  );
}

function TasawaQApp() {
  const { t } = useTranslation();
  const [screen, setScreen] = useState<AppScreen>(initialScreen);
  const [isBooting, setIsBooting] = useState(true);
  const [isSplashVisible, setIsSplashVisible] = useState(true);
  const [cart, setCart] = useState<Cart | null>(null);

  useEffect(() => {
    let isMounted = true;
    const splashTimer = setTimeout(() => {
      if (isMounted) setIsSplashVisible(false);
    }, splashDurationMs);

    async function restoreSession() {
      const language = await resolveInitialLanguage();
      if (i18n.language !== language) await i18n.changeLanguage(language);
      if (reconcileRTL(language)) {
        // A native reload is about to happen (see reconcileRTL's doc comment).
        // Deliberately skip setIsBooting(false) so the loading screen stays
        // up instead of flashing mis-mirrored UI before the reload lands.
        reloadApp();
        return;
      }

      try {
        const [accessToken, storedRefreshToken] = await Promise.all([getAccessToken(), getRefreshToken()]);
        if (!accessToken) return;

        try {
          const user = await fetchCurrentUser(accessToken);
          if (isMounted) setScreen(homeForUser(user));
        } catch {
          if (!storedRefreshToken) throw new Error("No refresh token");
          const result = await refreshSession(storedRefreshToken);
          await saveTokens(result);
          if (isMounted) setScreen(authResultToHome(result));
        }
      } catch {
        await clearTokens();
      } finally {
        if (isMounted) setIsBooting(false);
      }
    }

    void restoreSession();
    return () => {
      isMounted = false;
      clearTimeout(splashTimer);
    };
  }, []);

  async function handleAuthenticated(result: AuthResult, notice?: string) {
    await saveTokens(result);
    const destination = authResultToHome(result);
    setScreen(destination.name === "home" ? { ...destination, notice } : destination);
  }

  async function handleLogout() {
    const accessToken = await getAccessToken();
    if (accessToken) {
      try {
        await logout(accessToken);
      } catch {
        // Local logout still clears credentials if the API is unavailable.
      }
    }
    await clearTokens();
    disconnectSocket();
    setCart(null);
    setScreen(goToLogin());
  }

  function handleAddToCart(
    restaurant: Pick<RestaurantSummary, "id" | "name">,
    item: MenuItemSummary & { allowSubstitution?: boolean }
  ) {
    if (cart && cart.restaurantId !== restaurant.id) {
      const confirmationMessage = t("common:startNewCartBody", {
        restaurantName: cart.restaurantName,
        newRestaurantName: restaurant.name
      });
      if (Platform.OS === "web") {
        if (
          typeof globalThis.confirm === "function" &&
          globalThis.confirm(`${t("common:startNewCartTitle")}\n\n${confirmationMessage}`)
        ) {
          setCart(startCart(restaurant, item));
        }
        return;
      }
      Alert.alert(
        t("common:startNewCartTitle"),
        confirmationMessage,
        [
          { text: t("common:cancel"), style: "cancel" },
          {
            text: t("common:clearCart"),
            style: "destructive",
            onPress: () => setCart(startCart(restaurant, item))
          }
        ]
      );
      return;
    }
    setCart((current) => (current ? addCartItem(current, item) : startCart(restaurant, item)));
  }

  function handleIncrementCartItem(menuItemId: string) {
    setCart((current) => {
      if (!current) return current;
      const line = current.items.find((item) => item.menuItemId === menuItemId);
      if (!line) return current;
      return setCartItemQuantity(current, menuItemId, line.quantity + 1);
    });
  }

  function handleDecrementCartItem(menuItemId: string) {
    setCart((current) => {
      if (!current) return current;
      const line = current.items.find((item) => item.menuItemId === menuItemId);
      if (!line) return current;
      return setCartItemQuantity(current, menuItemId, line.quantity - 1);
    });
  }

  function handleRemoveCartItem(menuItemId: string) {
    setCart((current) => (current ? removeCartItem(current, menuItemId) : current));
  }

  function handleToggleCartItemSubstitution(menuItemId: string, allowSubstitution: boolean) {
    setCart((current) => current ? setCartItemSubstitution(current, menuItemId, allowSubstitution) : current);
  }

  if (isSplashVisible) {
    return (
      <SafeAreaView style={styles.splashScreen}>
        <StatusBar backgroundColor="#FFFFFF" barStyle="dark-content" />
        <Image
          accessibilityLabel="JOVO"
          resizeMode="contain"
          source={logo}
          style={styles.splashLogo}
        />
      </SafeAreaView>
    );
  }

  if (isBooting) {
    return (
      <SafeAreaView style={styles.loadingScreen}>
        <StatusBar backgroundColor="#FFFFFF" barStyle="dark-content" />
        <View style={styles.centered}>
          <ActivityIndicator color="#0F766E" size="large" />
        </View>
      </SafeAreaView>
    );
  }

  switch (screen.name) {
    case "login":
      return (
        <LoginScreen
          notice={screen.notice}
          onAuthenticated={handleAuthenticated}
          onDriverSignup={(prefill) => setScreen(goToDriverSignup(prefill))}
          onForgotPassword={(prefill) => setScreen({ name: "forgot-password", prefill })}
          onRestaurantSignup={(prefill) => setScreen(goToRestaurantSignup(prefill))}
          onSignup={(prefill) => setScreen(goToSignup(prefill))}
          prefill={screen.prefill}
        />
      );
    case "signup":
      return (
        <SignupScreen
          onForgotPassword={(prefill) => setScreen({ name: "forgot-password", prefill })}
          onLogin={(prefill) => setScreen(goToLogin(prefill))}
          onOtpRequested={(input, result) => setScreen(signupRequestToOtp(input, result))}
          prefill={screen.prefill}
        />
      );
    case "restaurant-signup":
      return (
        <RestaurantRegistrationScreen
          onBack={(prefill) => setScreen(goToLogin(prefill))}
          onRegistered={(prefill, notice) => setScreen(goToLogin(prefill, notice))}
          prefill={screen.prefill}
        />
      );
    case "driver-signup":
      return (
        <DriverRegistrationScreen
          onBack={(prefill) => setScreen(goToLogin(prefill))}
          onRegistered={(prefill, notice) => setScreen(goToLogin(prefill, notice))}
          prefill={screen.prefill}
        />
      );
    case "forgot-password":
      return (
        <ForgotPasswordScreen
          onCreateAccount={(prefill) => setScreen(accountNotFoundToSignup(prefill))}
          onLogin={(prefill) => setScreen(goToLogin(prefill))}
          onOtpRequested={(input, result) => setScreen(forgotRequestToOtp(input, result))}
          prefill={screen.prefill}
        />
      );
    case "otp":
      return (
        <OtpScreen
          onAuthenticated={(result) => handleAuthenticated(result, t("common:accountCreatedNotice"))}
          onBack={() =>
            setScreen(
              screen.purpose === "signup"
                ? goToSignup({ countryCode: screen.countryCode, phoneNumber: screen.phoneNumber })
                : { name: "forgot-password", prefill: { countryCode: screen.countryCode, phoneNumber: screen.phoneNumber } }
            )
          }
          onResetToken={(token) => setScreen(resetOtpToNewPassword(token))}
          screen={screen}
        />
      );
    case "new-password":
      return (
        <NewPasswordScreen
          onBack={() => setScreen(goToLogin())}
          onSuccess={(message) => setScreen(goToLogin(undefined, message))}
          resetToken={screen.resetToken}
        />
      );
    case "home":
      if (screen.user.role === "CUSTOMER") {
        return (
          <CustomerHomeScreen
            notice={screen.notice}
            onBrowseRestaurants={() => setScreen(goToRestaurants(screen.user))}
            onBrowseSupermarkets={() => setScreen(goToSupermarkets(screen.user))}
            onLogout={handleLogout}
            onOpenAccount={() => setScreen(goToAccount(screen.user))}
            onOpenNotifications={() => setScreen(goToNotifications(screen.user))}
            onOpenRestaurant={(restaurant) => setScreen(goToRestaurantMenu(screen.user, restaurant))}
            onOpenSupermarket={(supermarket) => setScreen(goToSupermarketCatalog(screen.user, supermarket))}
            onViewOrders={() => setScreen(goToOrderHistory(screen.user))}
            user={screen.user}
          />
        );
      }
      return (
        <HomeScreen
          notice={screen.notice}
          onLogout={handleLogout}
          onManageOrders={
            screen.user.role === "RESTAURANT" ? () => setScreen(goToRestaurantOrders(screen.user)) : undefined
          }
          onManageRestaurant={
            screen.user.role === "RESTAURANT"
              ? () => setScreen(goToRestaurantManagement(screen.user))
              : undefined
          }
          onOpenDriverDashboard={
            screen.user.role === "DRIVER" ? () => setScreen(goToDriverHome(screen.user)) : undefined
          }
          onOpenNotifications={() => setScreen(goToNotifications(screen.user))}
          user={screen.user}
        />
      );
    case "account":
      return (
        <AccountScreen
          onBack={() => setScreen(homeForUser(screen.user))}
          onDeleted={handleLogout}
          onProfileUpdated={(user) => setScreen(goToAccount(user))}
          user={screen.user}
        />
      );
    case "restaurants":
      return (
        <RestaurantListScreen
          onBack={() => setScreen(homeForUser(screen.user))}
          onOpenRestaurant={(restaurant) => setScreen(goToRestaurantMenu(screen.user, restaurant))}
        />
      );
    case "restaurant-menu":
      return (
        <RestaurantMenuScreen
          cart={cart}
          onAddItem={(item) =>
            handleAddToCart({ id: screen.restaurantId, name: screen.restaurantName }, item)
          }
          onBack={() => setScreen(goToRestaurants(screen.user))}
          onViewCart={() => setScreen(goToCart(screen.user))}
          restaurantId={screen.restaurantId}
          restaurantName={screen.restaurantName}
        />
      );
    case "supermarkets":
      return (
        <SupermarketListScreen
          onBack={() => setScreen(homeForUser(screen.user))}
          onOpenSupermarket={(supermarket) => setScreen(goToSupermarketCatalog(screen.user, supermarket))}
        />
      );
    case "supermarket-catalog":
      return (
        <SupermarketCatalogScreen
          cart={cart}
          onAddItem={(item) => handleAddToCart({ id: screen.supermarketId, name: screen.supermarketName }, item)}
          onBack={() => setScreen(goToSupermarkets(screen.user))}
          onOpenProduct={(productId) => setScreen(goToSupermarketProduct(
            screen.user,
            { id: screen.supermarketId, name: screen.supermarketName },
            productId
          ))}
          onViewCart={() => setScreen(goToCart(screen.user))}
          supermarketId={screen.supermarketId}
          supermarketName={screen.supermarketName}
        />
      );
    case "supermarket-product":
      return (
        <SupermarketProductScreen
          cart={cart}
          onAddItem={(item) => handleAddToCart({ id: screen.supermarketId, name: screen.supermarketName }, item)}
          onBack={() => setScreen(goToSupermarketCatalog(
            screen.user,
            { id: screen.supermarketId, name: screen.supermarketName }
          ))}
          onViewCart={() => setScreen(goToCart(screen.user))}
          productId={screen.productId}
          supermarketId={screen.supermarketId}
        />
      );
    case "cart":
      return (
        <CartScreen
          cart={cart}
          onBack={() => setScreen(homeForUser(screen.user))}
          onCheckout={() => setScreen(goToCheckout(screen.user))}
          onDecrement={handleDecrementCartItem}
          onIncrement={handleIncrementCartItem}
          onRemove={handleRemoveCartItem}
          onToggleSubstitution={handleToggleCartItemSubstitution}
        />
      );
    case "checkout":
      return (
        <CheckoutScreen
          cart={cart}
          onBack={() => setScreen(goToCart(screen.user))}
          onPlaced={(order) => {
            setCart(null);
            setScreen(orderToConfirmation(screen.user, order));
          }}
        />
      );
    case "order-confirmation":
      return (
        <OrderConfirmationScreen
          onDone={() => setScreen(homeForUser(screen.user))}
          onViewOrders={() => setScreen(goToOrderHistory(screen.user))}
          order={screen.order}
        />
      );
    case "order-history":
      return (
        <OrderHistoryScreen
          onBack={() => setScreen(homeForUser(screen.user))}
          onOpenOrder={(orderId) => setScreen(goToOrderDetail(screen.user, orderId))}
        />
      );
    case "order-detail":
      return (
        <OrderDetailScreen onBack={() => setScreen(goToOrderHistory(screen.user))} orderId={screen.orderId} />
      );
    case "restaurant-orders":
      return (
        <RestaurantOrdersScreen
          onBack={() => setScreen(homeForUser(screen.user))}
          onOpenOrder={(orderId) => setScreen(goToRestaurantOrderDetail(screen.user, orderId))}
        />
      );
    case "restaurant-management":
      return <RestaurantManagementScreen onBack={() => setScreen(homeForUser(screen.user))} />;
    case "restaurant-order-detail":
      return (
        <RestaurantOrderDetailScreen
          onBack={() => setScreen(goToRestaurantOrders(screen.user))}
          orderId={screen.orderId}
        />
      );
    case "driver-home":
      return (
        <DriverHomeScreen
          onBack={() => setScreen(homeForUser(screen.user))}
          onOpenDelivery={(deliveryId) => setScreen(goToDeliveryDetail(screen.user, deliveryId))}
        />
      );
    case "delivery-detail":
      return (
        <DeliveryDetailScreen deliveryId={screen.deliveryId} onBack={() => setScreen(goToDriverHome(screen.user))} />
      );
    case "admin-dashboard":
      return (
        <AdminDashboardScreen
          onAuditLog={() => setScreen(goToAdminAuditLog(screen.user))}
          onDrivers={() => setScreen(goToAdminDrivers(screen.user))}
          onLogout={handleLogout}
          onNotifications={() => setScreen(goToNotifications(screen.user))}
          onOffers={() => setScreen(goToAdminOffers(screen.user))}
          onOrders={() => setScreen(goToAdminOrders(screen.user))}
          onRestaurants={() => setScreen(goToAdminRestaurants(screen.user))}
          onUsers={() => setScreen(goToAdminUsers(screen.user))}
          user={screen.user}
        />
      );
    case "admin-offers":
      return <AdminOffersScreen onBack={() => setScreen(goToAdminDashboard(screen.user))} />;
    case "admin-restaurants":
      return (
        <AdminRestaurantsScreen
          onBack={() => setScreen(goToAdminDashboard(screen.user))}
          onOpenRestaurant={(restaurantId) => setScreen(goToAdminRestaurantDetail(screen.user, restaurantId))}
        />
      );
    case "admin-restaurant-detail":
      return (
        <AdminRestaurantDetailScreen
          onBack={() => setScreen(goToAdminRestaurants(screen.user))}
          restaurantId={screen.restaurantId}
        />
      );
    case "admin-orders":
      return (
        <AdminOrdersScreen
          onBack={() => setScreen(goToAdminDashboard(screen.user))}
          onOpenOrder={(orderId) => setScreen(goToAdminOrderDetail(screen.user, orderId))}
        />
      );
    case "admin-order-detail":
      return (
        <AdminOrderDetailScreen
          onBack={() => setScreen(goToAdminOrders(screen.user))}
          orderId={screen.orderId}
        />
      );
    case "admin-drivers":
      return <AdminDriversScreen onBack={() => setScreen(goToAdminDashboard(screen.user))} />;
    case "admin-users":
      return <AdminUsersScreen onBack={() => setScreen(goToAdminDashboard(screen.user))} />;
    case "admin-audit-log":
      return <AdminAuditLogScreen onBack={() => setScreen(goToAdminDashboard(screen.user))} />;
    case "notifications":
      return <NotificationInboxScreen onBack={() => setScreen(homeForUser(screen.user))} />;
  }
}

const styles = StyleSheet.create({
  splashScreen: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    flex: 1,
    justifyContent: "center"
  },
  splashLogo: {
    height: 96,
    maxWidth: 300,
    width: "70%"
  },
  loadingScreen: {
    backgroundColor: "#FFFFFF",
    flex: 1
  },
  centered: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center"
  }
});
