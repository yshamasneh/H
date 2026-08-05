import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  StatusBar,
  StyleSheet,
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
} from "./src/api";
import {
  ForgotPasswordScreen,
  HomeScreen,
  LoginScreen,
  NewPasswordScreen,
  OtpScreen,
  SignupScreen
} from "./src/auth-screens";
import {
  addCartItem,
  removeCartItem,
  setCartItemQuantity,
  startCart,
  type Cart
} from "./src/cart";
import {
  CartScreen,
  CheckoutScreen,
  OrderConfirmationScreen,
  OrderDetailScreen,
  OrderHistoryScreen
} from "./src/cart-screens";
import {
  accountNotFoundToSignup,
  authResultToHome,
  forgotRequestToOtp,
  goToCart,
  goToCheckout,
  goToLogin,
  goToOrderDetail,
  goToOrderHistory,
  goToRestaurantMenu,
  goToRestaurants,
  goToSignup,
  homeForUser,
  initialScreen,
  orderToConfirmation,
  resetOtpToNewPassword,
  signupRequestToOtp,
  type AppScreen
} from "./src/navigation";
import { RestaurantListScreen, RestaurantMenuScreen } from "./src/restaurant-screens";
import { clearTokens, getAccessToken, getRefreshToken, saveTokens } from "./src/session";

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
          if (isMounted) setScreen({ name: "home", user });
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
    setScreen({ ...authResultToHome(result), notice });
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
    setCart(null);
    setScreen(goToLogin());
  }

  function handleAddToCart(restaurant: Pick<RestaurantSummary, "id" | "name">, item: MenuItemSummary) {
    if (cart && cart.restaurantId !== restaurant.id) {
      Alert.alert(
        "Start a new cart?",
        `Your cart has items from ${cart.restaurantName}. Adding an item from ${restaurant.name} will clear it and start a new order.`,
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
      return (
        <HomeScreen
          notice={screen.notice}
          onBrowseRestaurants={
            screen.user.role === "CUSTOMER" ? () => setScreen(goToRestaurants(screen.user)) : undefined
          }
          onLogout={handleLogout}
          onViewOrders={
            screen.user.role === "CUSTOMER" ? () => setScreen(goToOrderHistory(screen.user)) : undefined
          }
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
