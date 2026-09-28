import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Pressable, Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ToastProvider, useToast } from "./toast";

function Trigger(props: { onUndo: () => void }) {
  const { showToast } = useToast();
  return (
    <Pressable onPress={() => showToast("Labneh removed from the basket", { label: "Undo", onPress: props.onUndo })}>
      <Text>remove</Text>
    </Pressable>
  );
}

test("a toast can carry an action such as Undo, which runs and closes the toast", async () => {
  const onUndo = jest.fn();
  render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
      <ToastProvider>
        <Trigger onUndo={onUndo} />
      </ToastProvider>
    </SafeAreaProvider>
  );
  fireEvent.press(screen.getByText("remove"));
  expect(screen.getByText("Labneh removed from the basket")).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByText("Undo"));
  });
  expect(onUndo).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Labneh removed from the basket")).toBeNull();
});
