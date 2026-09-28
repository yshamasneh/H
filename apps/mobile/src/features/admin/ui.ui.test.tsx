import { render, screen, waitFor } from "@testing-library/react-native";
import { StyleSheet, Text } from "react-native";
import { useEffect } from "react";
import { ThemeProvider, useTheme } from "../../theme/theme-context";
import { darkColors, lightColors } from "../../theme/tokens";
import { Card, StatusPill } from "./ui";

function DarkMode({ children }: { children: React.ReactNode }) {
  const { setMode } = useTheme();
  useEffect(() => setMode("dark"), [setMode]);
  return <>{children}</>;
}

/** The nearest ancestor that paints a background. */
function backgroundOf(start: unknown): string | undefined {
  let node = start as { parent: unknown; props?: { style?: unknown } } | null;
  while (node) {
    const flat = StyleSheet.flatten((node.props?.style ?? undefined) as never) as { backgroundColor?: string } | undefined;
    if (flat?.backgroundColor) return flat.backgroundColor;
    node = node.parent as typeof node;
  }
  return undefined;
}

test("admin cards follow the app's light/dark theme instead of a fixed light palette", async () => {
  const light = render(
    <Card>
      <Text testID="inside">x</Text>
    </Card>
  );
  expect(backgroundOf(light.getByTestId("inside"))).toBe(lightColors.surface);
  light.unmount();

  render(
    <ThemeProvider>
      <DarkMode>
        <Card>
          <Text testID="inside">x</Text>
        </Card>
      </DarkMode>
    </ThemeProvider>
  );
  await waitFor(() => expect(backgroundOf(screen.getByTestId("inside"))).toBe(darkColors.surface));
});

test("status pills take their colours from the active palette", async () => {
  render(
    <ThemeProvider>
      <DarkMode>
        <StatusPill status="DELIVERED" />
      </DarkMode>
    </ThemeProvider>
  );
  await waitFor(() =>
    expect(backgroundOf(screen.getByText(/DELIVERED|تم التوصيل|Delivered/))).toBe(darkColors.successSubtle)
  );
});
