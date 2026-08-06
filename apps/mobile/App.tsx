import { useEffect, useState } from "react";
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
  addCartItem,
  removeCartItem,
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
  goToAdminRestaurantDetail,
  goToAdminRestaurants,
  goToAdminUsers,
  goToCart,
  goToCheckout,
  goToDeliveryDetail,
  goToDriverHome,
  goToLogin,
  goToNotifications,
  goToOrderDetail,
  goToOrderHistory,
  goToRestaurantMenu,
  goToRestaurantOrderDetail,
  goToRestaurantOrders,
  goToRestaurants,
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
import { CustomerHomeScreen } from "./src/features/customer/home-screen";

const splashDurationMs = 3000;
const logo = require("./assets/logo/TasawaQ.png");

export default function App() {
  return (
    <SafeAreaProvider>
      <TasawaQApp />
    </SafeAreaProvider>
  );
}

function TasawaQApp() {
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

  function handleAddToCart(restaurant: Pick<RestaurantSummary, "id" | "name">, item: MenuItemSummary) {
    if (cart && cart.restaurantId !== restaurant.id) {
      const confirmationMessage = `Your cart has items from ${cart.restaurantName}. Adding an item from ${restaurant.name} will clear it and start a new order.`;
      if (Platform.OS === "web") {
        if (typeof globalThis.confirm === "function" && globalThis.confirm(`Start a new cart?\n\n${confirmationMessage}`)) {
          setCart(startCart(restaurant, item));
        }
        return;
      }
      Alert.alert(
        "Start a new cart?",
        confirmationMessage,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Clear Cart",
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

  if (isSplashVisible) {
    return (
      <SafeAreaView style={styles.splashScreen}>
        <StatusBar backgroundColor="#F5FAFC" barStyle="dark-content" />
        <Image
          accessibilityLabel="TasawaQ logo"
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
        <StatusBar backgroundColor="#F5FAFC" barStyle="dark-content" />
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
          onForgotPassword={(prefill) => setScreen({ name: "forgot-password", prefill })}
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
          onAuthenticated={(result) =>
            handleAuthenticated(result, "Your customer account was created successfully.")
          }
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
            onLogout={handleLogout}
            onOpenNotifications={() => setScreen(goToNotifications(screen.user))}
            onOpenRestaurant={(restaurant) => setScreen(goToRestaurantMenu(screen.user, restaurant))}
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
          onOpenDriverDashboard={
            screen.user.role === "DRIVER" ? () => setScreen(goToDriverHome(screen.user)) : undefined
          }
          onOpenNotifications={() => setScreen(goToNotifications(screen.user))}
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
    case "cart":
      return (
        <CartScreen
          cart={cart}
          onBack={() => setScreen(homeForUser(screen.user))}
          onCheckout={() => setScreen(goToCheckout(screen.user))}
          onDecrement={handleDecrementCartItem}
          onIncrement={handleIncrementCartItem}
          onRemove={handleRemoveCartItem}
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
          onOrders={() => setScreen(goToAdminOrders(screen.user))}
          onRestaurants={() => setScreen(goToAdminRestaurants(screen.user))}
          onUsers={() => setScreen(goToAdminUsers(screen.user))}
          user={screen.user}
        />
      );
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
    backgroundColor: "#F5FAFC",
    flex: 1,
    justifyContent: "center"
  },
  splashLogo: {
    height: 320,
    maxWidth: 460,
    width: "88%"
  },
  loadingScreen: {
    backgroundColor: "#F5FAFC",
    flex: 1
  },
  centered: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center"
  }
});
