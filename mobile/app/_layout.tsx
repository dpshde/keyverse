import { ThemeProvider as NavThemeProvider } from "@react-navigation/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider } from "@/src/context/SessionContext";
import { ThemeProvider, useTheme } from "@/src/context/ThemeContext";
import { StackBackButton } from "@/src/components/StackBackButton";
import { DeepLinkHandler } from "@/src/components/DeepLinkHandler";

export { ErrorBoundary } from "expo-router";

/** Prefer home as stack root so Back has a real destination. */
export const unstable_settings = {
  initialRouteName: "home",
};

function RootNavigation() {
  const { navTheme, resolved } = useTheme();
  return (
    <NavThemeProvider value={navTheme}>
      <StatusBar style={resolved === "dark" ? "light" : "dark"} />
      <DeepLinkHandler />
      <Stack
        screenOptions={{
          headerBackTitle: "Back",
          headerBackButtonDisplayMode: "minimal",
          // Compact chevron — system HeaderBackButton oversizes the glass circle on iOS 26
          headerLeft: () => <StackBackButton />,
          contentStyle: { backgroundColor: navTheme.colors.background },
          headerStyle: { backgroundColor: navTheme.colors.card },
          headerTintColor: navTheme.colors.text,
          headerTitleStyle: { color: navTheme.colors.text },
        }}
      >
        <Stack.Screen name="index" options={{ title: "keyverse", headerShown: false }} />
        <Stack.Screen name="home" options={{ headerShown: false, headerLeft: () => null }} />
        <Stack.Screen
          name="read/[slug]"
          options={({ route }) => {
            // Prev uses reverse replace animation; next uses push direction
            const anim = (route.params as { anim?: string } | undefined)?.anim;
            return {
              title: "Read",
              animationTypeForReplace: anim === "prev" ? "pop" : "push",
            };
          }}
        />
        <Stack.Screen name="note/[slug]" options={{ title: "Note" }} />
        <Stack.Screen name="settings" options={{ title: "Settings" }} />
        <Stack.Screen name="activity" options={{ title: "Activity" }} />
        <Stack.Screen name="pack" options={{ title: "Pack" }} />
        <Stack.Screen name="share" options={{ title: "Sync" }} />
      </Stack>
    </NavThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <ThemeProvider>
          <SessionProvider>
            <RootNavigation />
          </SessionProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
