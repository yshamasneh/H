/** Customer-only cart state and calculations shared by native and web builds. */
export type CartItem = {
  menuItemId: string;
  name: string;
  priceMinor: number;
  quantity: number;
};

export type Cart = {
  restaurantId: string;
  restaurantName: string;
  items: CartItem[];
};

export type CartCandidateItem = { id: string; name: string; priceMinor: number };
export type CartCandidateRestaurant = { id: string; name: string };

export function startCart(restaurant: CartCandidateRestaurant, item: CartCandidateItem): Cart {
  return {
    restaurantId: restaurant.id,
    restaurantName: restaurant.name,
    items: [{ menuItemId: item.id, name: item.name, priceMinor: item.priceMinor, quantity: 1 }]
  };
}

export function addCartItem(cart: Cart, item: CartCandidateItem): Cart {
  const existing = cart.items.find((line) => line.menuItemId === item.id);
  if (existing) {
    return {
      ...cart,
      items: cart.items.map((line) =>
        line.menuItemId === item.id ? { ...line, quantity: line.quantity + 1 } : line
      )
    };
  }
  return {
    ...cart,
    items: [...cart.items, { menuItemId: item.id, name: item.name, priceMinor: item.priceMinor, quantity: 1 }]
  };
}

export function setCartItemQuantity(cart: Cart, menuItemId: string, quantity: number): Cart | null {
  if (quantity <= 0) {
    return removeCartItem(cart, menuItemId);
  }
  return {
    ...cart,
    items: cart.items.map((line) => (line.menuItemId === menuItemId ? { ...line, quantity } : line))
  };
}

export function removeCartItem(cart: Cart, menuItemId: string): Cart | null {
  const items = cart.items.filter((line) => line.menuItemId !== menuItemId);
  return items.length > 0 ? { ...cart, items } : null;
}

export function cartBelongsToRestaurant(cart: Cart | null, restaurantId: string): boolean {
  return cart === null || cart.restaurantId === restaurantId;
}

export function cartSubtotalMinor(cart: Cart): number {
  return cart.items.reduce((sum, line) => sum + line.priceMinor * line.quantity, 0);
}

export function cartItemCount(cart: Cart): number {
  return cart.items.reduce((sum, line) => sum + line.quantity, 0);
}
