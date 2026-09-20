import { act, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import i18n from "../i18n";
import { PriceDisplay, SaleBadge } from "./sale-price";

const format = (minor: number) => `${(minor / 100).toFixed(2)} ILS`;
const flat = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;

async function language(code: "ar" | "en") {
  await act(async () => {
    await i18n.changeLanguage(code);
  });
}

afterAll(() => language("en"));

describe("the sale badge", () => {
  test("reads 'Save 50%' in English, with the percentage worked out from the two prices", async () => {
    await language("en");
    render(<SaleBadge item={{ priceMinor: 2000, salePriceMinor: 1000 }} />);
    expect(screen.getByText("Save 50%")).toBeTruthy();
  });

  test("reads 'وفّر 50%' in Arabic", async () => {
    await language("ar");
    render(<SaleBadge item={{ priceMinor: 2000, salePriceMinor: 1000 }} />);
    expect(screen.getByText("وفّر 50%")).toBeTruthy();
  });

  test("the number and percent sign come through the translation intact in both languages", async () => {
    for (const [code, expected] of [["en", "Save 25%"], ["ar", "وفّر 25%"]] as const) {
      await language(code);
      const view = render(<SaleBadge item={{ priceMinor: 1999, salePriceMinor: 1499 }} />);
      expect(view.getByText(expected)).toBeTruthy();
      view.unmount();
    }
  });

  test("the percentage follows the prices when either one changes", async () => {
    await language("en");
    const view = render(<SaleBadge item={{ priceMinor: 2000, salePriceMinor: 1000 }} />);
    expect(view.getByText("Save 50%")).toBeTruthy();
    view.rerender(<SaleBadge item={{ priceMinor: 2000, salePriceMinor: 1500 }} />);
    expect(view.getByText("Save 25%")).toBeTruthy();
    view.rerender(<SaleBadge item={{ priceMinor: 4000, salePriceMinor: 1500 }} />);
    expect(view.getByText("Save 63%")).toBeTruthy();
  });

  test("is an orange sticker with white text, pinned to the leading corner by logical edge", async () => {
    await language("en");
    const view = render(<SaleBadge item={{ priceMinor: 2000, salePriceMinor: 1000 }} />);
    const text = view.getByText("Save 50%");
    expect(flat(text).color).toBe("#FFFFFF");
    // The sticker is the root View of the component.
    const style = flat(view.toJSON() as { props: { style?: unknown } });
    expect(style.backgroundColor).toBe("#F45A00");
    expect(style.position).toBe("absolute");
    // Logical `start`, not a physical left/right: the sticker follows the layout direction rather
    // than landing on the wrong side of the picture in Arabic.
    expect(style.start).toBeDefined();
    expect(style.left).toBeUndefined();
    expect(style.right).toBeUndefined();
  });

  test("renders nothing for a product that is not on sale", async () => {
    await language("en");
    for (const item of [
      { priceMinor: 2000, salePriceMinor: null },
      { priceMinor: 2000 },
      { priceMinor: 2000, salePriceMinor: 2000 }
    ]) {
      const view = render(<SaleBadge item={item} />);
      expect(view.toJSON()).toBeNull();
      view.unmount();
    }
  });
});

describe("the price display", () => {
  test("with no reduction it is exactly the one price, as before", () => {
    const view = render(<PriceDisplay effectiveMinor={2000} format={format} priceStyle={{ fontSize: 20 }} regularMinor={2000} />);
    expect(view.getByText("20.00 ILS")).toBeTruthy();
    expect(view.queryAllByText(/ILS/)).toHaveLength(1);
  });

  test("on sale it strikes the regular price and shows the charged price prominently, in orange", () => {
    const view = render(<PriceDisplay effectiveMinor={1000} format={format} priceStyle={{ fontSize: 20 }} regularMinor={2000} />);
    const regular = view.getByText("20.00 ILS");
    const sale = view.getByText("10.00 ILS");
    expect(flat(regular).textDecorationLine).toBe("line-through");
    expect(flat(sale).textDecorationLine).toBeUndefined();
    expect(flat(sale).color).toBe("#F45A00");
    expect(flat(sale).fontSize).toBe(20);
  });
});
