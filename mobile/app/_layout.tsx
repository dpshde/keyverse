import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";
import { SessionProvider } from "@/src/context/SessionContext";

export { ErrorBoundary } from "expo-router";

export default function RootLayout() {
  const scheme = useColorScheme();
  return (
    <SessionProvider>
      <ThemeProvider value={scheme === "dark" ? DarkTheme : DefaultTheme}>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerBackTitle: "Back" }}>
          <Stack.Screen name="index" options={{ title: "keyverse", headerShown: false }} />
          <Stack.Screen name="home" options={{ title: "Notes" }} />
          <Stack.Screen name="read/[slug]" options={{ title: "Read" }} />
          <Stack.Screen name="note/[slug]" options={{ title: "Note" }} />
          <Stack.Screen name="pack" options={{ title: "Pack" }} />
          <Stack.Screen name="share" options={{ title: "Share" }} />
        </Stack>
      </ThemeProvider>
    </SessionProvider>
  );
}
