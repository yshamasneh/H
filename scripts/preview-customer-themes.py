"""Local browser verification. Requires Python playwright and a running Expo web dev server.

All API traffic is fulfilled with fixed test fixtures; external network requests are blocked.
No fixture is imported by the app. Prices and offers are identical for all themes.
Run: python scripts/preview-customer-themes.py [--full] [--url http://localhost:8082]
"""
import argparse
import json
import sys
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.stdout.reconfigure(encoding="utf-8")
OUT = ROOT / "docs" / "customer-theme-previews"
OUT.mkdir(parents=True, exist_ok=True)

def translations(language, namespace):
    return json.loads((ROOT / f"apps/mobile/src/i18n/locales/{language}/{namespace}.json").read_text(encoding="utf-8"))

def run_case(browser, base, preset, mode, language, width, full):
    customer = translations(language, "customer")
    common = translations(language, "common")
    cart_labels = translations(language, "cart")
    name = "محمد الشماسنة" if language == "ar" else "Alexandra Example"
    if width == 320:
        name = "عبدالرحمنعبدالله الشماسنة" if language == "ar" else "Alexandra-Marguerite Example"
    user = dict(id="preview-customer", fullName=name, phone="+970599000000", role="CUSTOMER")
    store = dict(id="preview-market", name="JOVO MARKET", isOpenNow=True, businessType="SUPERMARKET")
    product = dict(id="preview-milk", name="حليب" if language == "ar" else "Milk", description="1 L", priceMinor=750,
                   effectivePriceMinor=750, salePriceMinor=None, unitLabel="1 L", imageUrl=base+"/preview-product.jpg",
                   categoryId="dairy", categoryName="ألبان" if language == "ar" else "Dairy", brand="JOVO", sku="PREVIEW",
                   stockQuantity=10, isFeatured=True, isVariableWeight=False, offer=None)
    offer = dict(id="preview-offer", type="FREE_DELIVERY", restaurantId=None, restaurantName=None,
                 restaurantBusinessType=None, menuItemId=None, title="توصيل مجاني" if language == "ar" else "Free delivery",
                 description=None, discountPercent=None, imageUrl=None, endsAt=None, minimumSubtotalMinor=0,
                 maxDiscountMinor=None, isActive=True, isFeatured=True, startsAt="2026-01-01T00:00:00Z")
    cart = dict(restaurantId=store["id"], restaurantName=store["name"], items=[dict(menuItemId=product["id"], name=product["name"],
                priceMinor=750, quantity=1, unitLabel="1 L", allowSubstitution=False, imageUrl=product["imageUrl"])])
    address = dict(id="preview-address", label="Home", addressLine="Preview Street, Biddu", latitude=31.838, longitude=35.140,
                   isDefault=True, createdAt="2026-01-01T00:00:00Z", updatedAt="2026-01-01T00:00:00Z")
    context = browser.new_context(viewport={"width": width, "height": 844}, device_scale_factor=1, service_workers="block")
    context.add_init_script("""(config => {
      localStorage.setItem('wasel_language', config.language);
      localStorage.setItem('jovo-theme-mode', config.mode);
      localStorage.setItem('wasel_customer_cart', JSON.stringify(config.cart));
      sessionStorage.setItem('wasel_access_token', 'local-preview-only');
      sessionStorage.setItem('wasel_cached_user', JSON.stringify(config.user));
      const NativeSocket = window.WebSocket;
      window.WebSocket = class extends NativeSocket {
        constructor(url, protocols) {
          const target = new URL(url);
          // Redirect external sockets to a closed loopback port in this test page.
          super(target.host === location.host ? url : 'ws://127.0.0.1:1', protocols);
        }
      };
    })(%s)""" % json.dumps(dict(language=language, mode=mode, cart=cart, user=user)))
    unexpected = []
    def route_request(route):
        url = urlparse(route.request.url)
        path = url.path
        if "/api/" in path:
            if path.endswith("/auth/me"): data = {"user": user}
            elif path.endswith("/users/me/addresses"): data = [address]
            elif path.endswith("/users/me"): data = {**user, "email": None, "createdAt": "2026-01-01T00:00:00Z"}
            elif path.endswith("/settings"): data = {"substitutionOptionEnabled": True}
            elif path.endswith("/landmarks"): data = []
            elif path.endswith("/supermarkets"): data = dict(items=[store], page=1, pageSize=20, total=1)
            elif path.endswith("/catalog"): data = dict(supermarket=store, products=[product], departments=[dict(id="dairy", name=product["categoryName"], productCount=1, sortOrder=0)], page=1, pageSize=50, total=1)
            elif "/products/" in path: data = dict(supermarket=store, product=product)
            elif path.endswith("/status"): data = {"isOpenNow": True}
            elif path.endswith("/offers/active"): data = [offer]
            elif path.endswith("/notifications/me"): data = dict(items=[], unreadCount=1, page=1, pageSize=30, total=0)
            elif path.endswith("/orders/me"): data = dict(items=[], page=1, pageSize=20, total=0)
            elif path.endswith("/orders/quote"): data = dict(subtotalMinor=750, deliveryFeeMinor=1000, serviceFeeMinor=0, discountMinor=0, totalMinor=1750, deliveryDistanceMeters=1000, cashRoundingMinor=50, cashDueMinor=1800, appliedPromotions=[])
            else:
                unexpected.append(path)
                route.fulfill(status=404, content_type="application/json", body='{"message":"Preview endpoint unavailable"}')
                return
            route.fulfill(status=200, content_type="application/json", body=json.dumps(data), headers={"Access-Control-Allow-Origin": "*"})
        elif path == "/preview-product.jpg":
            route.fulfill(path=str(ROOT / "apps/mobile/assets/products/missing-products.jpg"), content_type="image/jpeg")
        elif url.hostname in ("localhost", "127.0.0.1") and url.port == urlparse(base).port:
            route.continue_()
        else:
            route.abort()
    context.route("**/*", route_request)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(f"{base}/?customerTheme={preset}")
    header = page.get_by_test_id("customer-home-header")
    header.wait_for(timeout=120000)
    page.get_by_test_id("header-unread").wait_for()
    page.evaluate("document.fonts.ready")
    page.wait_for_timeout(500)
    stem = f"{preset}-{mode}-{language}-{width}"
    page.screenshot(path=str(OUT / f"{stem}-home.png"))
    header.screenshot(path=str(OUT / f"{stem}-header.png"))
    print(f"Captured {stem}", flush=True)
    greeting = page.get_by_test_id("header-greeting").bounding_box()
    brand = page.get_by_test_id("header-brand").bounding_box()
    assert (greeting["x"] > brand["x"]) == (language == "ar"), stem
    assert header.bounding_box()["height"] <= 180, stem
    assert page.get_by_test_id("header-first-name").inner_text() == name.split()[0]
    assert page.get_by_test_id("header-first-name").get_attribute("aria-label") == name.split()[0]
    assert page.get_by_test_id("header-squirrel").evaluate("element => element.getAnimations({subtree: true}).length === 0")
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), stem
    notification = page.get_by_role("button", name=common["notifications"], exact=True)
    assert notification.bounding_box()["width"] >= 44
    notification.click(timeout=5000)
    page.get_by_role("button", name=common["back"], exact=True).click()
    header.wait_for()
    if full:
        page.get_by_text(product["name"], exact=True).last.scroll_into_view_if_needed()
        page.screenshot(path=str(OUT / f"{stem}-home-scrolled.png"))
        page.get_by_role("tab").filter(has_text=customer["nav"]["browse"]).click()
        page.get_by_text(product["name"], exact=True).first.wait_for()
        page.screenshot(path=str(OUT / f"{stem}-catalog.png"))
        page.get_by_text(product["name"], exact=True).first.click()
        page.get_by_text(customer["supermarket"]["productDetailsTitle"], exact=True).wait_for()
        page.screenshot(path=str(OUT / f"{stem}-product.png"))
        page.get_by_label(customer["supermarket"]["goBackAccessibility"], exact=True).click()
        page.get_by_role("tab").filter(has_text=customer["nav"]["cart"]).click()
        checkout = page.get_by_text(cart_labels["cart"]["proceedToCheckout"], exact=True)
        checkout.wait_for()
        page.screenshot(path=str(OUT / f"{stem}-cart.png"))
        checkout.click()
        page.get_by_text(cart_labels["checkout"]["orderSummaryEstimate"], exact=True).wait_for()
        page.screenshot(path=str(OUT / f"{stem}-checkout.png"))
        order_button = page.get_by_text(cart_labels["checkout"]["placeOrder"], exact=True)
        order_button.scroll_into_view_if_needed()
        page.screenshot(path=str(OUT / f"{stem}-checkout-bottom.png"))
        # Return through the real navigation without placing an order.
        page.get_by_role("button").first.click()
        page.get_by_role("tab").filter(has_text=customer["nav"]["orders"]).click()
        page.wait_for_timeout(200)
        page.screenshot(path=str(OUT / f"{stem}-orders.png"))
        page.get_by_role("tab").filter(has_text=customer["nav"]["account"]).click()
        page.get_by_text(customer["account"]["personalDataTitle"], exact=True).wait_for()
        page.screenshot(path=str(OUT / f"{stem}-account.png"))
        page.get_by_label(common["settings"], exact=True).click()
        page.get_by_role("switch").first.click()
        opposite = "light" if mode == "dark" else "dark"
        page.wait_for_function("mode => localStorage.getItem('jovo-theme-mode') === mode", arg=opposite)
        page.get_by_label(common["back"], exact=True).click()
        header.wait_for()
        if preset != "normal":
            page.get_by_text(customer["seasonal"][preset], exact=True).wait_for()
    assert not errors, errors
    assert not unexpected, unexpected
    print(f"PASS {stem}", flush=True)
    context.close()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://localhost:8082")
    parser.add_argument("--full", action="store_true")
    parser.add_argument("--language", choices=["ar", "en"])
    parser.add_argument("--preset", choices=["normal", "ramadan", "newYear"])
    parser.add_argument("--mode", choices=["light", "dark"])
    parser.add_argument("--width", type=int, choices=[320, 390])
    args = parser.parse_args()
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for preset in ([args.preset] if args.preset else ["normal", "ramadan", "newYear"] if args.full else ["normal"]):
            for mode in ([args.mode] if args.mode else ["light", "dark"] if args.full else ["light"]):
                for language in ([args.language] if args.language else ["ar", "en"] if args.full else ["ar"]):
                    for width in ([args.width] if args.width else [320, 390] if args.full else [390]):
                        try:
                            run_case(browser, args.url, preset, mode, language, width, args.full)
                        except Exception as error:
                            print(f"FAIL {type(error).__name__}: {error}", flush=True)
                            raise
        browser.close()

if __name__ == "__main__":
    main()
