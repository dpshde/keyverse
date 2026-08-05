import { ThemeProvider as NavThemeProvider } from "@react-navigation/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Platform, StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { enableFreeze, enableScreens } from "react-native-screens";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider } from "@/src/context/SessionContext";
import { ThemeProvider, useTheme } from "@/src/context/ThemeContext";
import { HeaderScrim } from "@/src/components/HeaderScrim";
import { StackBackButton } from "@/src/components/StackBackButton";
import { DeepLinkHandler } from "@/src/components/DeepLinkHandler";
import { MOTION_MS } from "@/src/lib/motion";

// Native stack: detach inactive scenes from the JS tree while off-screen.
enableScreens(true);
enableFreeze(true);

export { ErrorBoundary } from "expo-router";

/** Prefer home as stack root so Back has a real destination. */
export const unstable_settings = {
  initialRouteName: "home",
};

/**
 * Shared stack motion — leaner than the default multi-effect push.
 * freezeOnBlur keeps heavy readers/outliners from re-rendering under a sheet.
 */
const stackScreenOptions = {
  headerBackTitle: "Back",
  headerBackButtonDisplayMode: "minimal" as const,
  // Compact chevron — system HeaderBackButton oversizes the glass circle on iOS 26
  headerLeft: () => <StackBackButton />,
  // Paper bar + soft fade into content (see HeaderScrim) — not a white slab,
  // not a full transparent overlay that collides with verse text.
  headerTransparent: false,
  headerShadowVisible: false,
  headerBackground: () => <HeaderScrim />,
  // Hierarchical nav: native simple_push (spatial depth). Lateral sheets: slide_from_right.
  // Duration from motion tokens; OS reduce-motion short-circuits via system UI.
  animation: Platform.select({
    ios: "simple_push" as const,
    default: "fade_from_bottom" as const,
  }),
  animationDuration: MOTION_MS.nav,
  gestureEnabled: true,
  fullScreenGestureEnabled: true,
  freezeOnBlur: true,
};

function RootNavigation() {
  const { navTheme, resolved } = useTheme();
  return (
    <NavThemeProvider value={navTheme}>
      <StatusBar style={resolved === "dark" ? "light" : "dark"} />
      <DeepLinkHandler />
      <Stack
        screenOptions={{
          ...stackScreenOptions,
          contentStyle: { backgroundColor: navTheme.colors.background },
          // Background painted by HeaderScrim (paper + fade)
          headerStyle: {
            backgroundColor: "transparent",
            // Android honors height; iOS native bar stays ~44pt content + status.
            ...(Platform.OS === "android" ? { height: 48 } : null),
          },
          headerTintColor: navTheme.colors.text,
          headerTitleStyle: {
            color: navTheme.colors.text,
            fontSize: 16,
            fontWeight: "700",
          },
          headerShadowVisible: false,
          headerBackground: () => <HeaderScrim />,
        }}
      >
        <Stack.Screen
          name="index"
          options={{
            title: "keyverse",
            headerShown: false,
            animation: "none",
            // Not a real destination — never swipe-pop through the redirect shell
            gestureEnabled: false,
            fullScreenGestureEnabled: false,
          }}
        />
        <Stack.Screen
          name="home"
          options={{
            headerShown: false,
            headerLeft: () => null,
            animation: "none",
            // Home is the stack root: no edge / full-screen swipe back (or forward)
            gestureEnabled: false,
            fullScreenGestureEnabled: false,
          }}
        />
        <Stack.Screen
          name="read/[slug]"
          options={{
            title: "Read",
            // Open from home still pushes; chapter prev/next uses setParams (no stack anim).
            animation: "simple_push",
            // Edge swipe only — full-screen back fights verse drag / scroll
            // and makes it too easy to leave the reader by accident.
            fullScreenGestureEnabled: false,
            gestureEnabled: true,
          }}
        />
        <Stack.Screen
          name="note/[slug]"
          options={{
            title: "Note",
            animation: "simple_push",
            // Same as reader: typing/selection shouldn’t trigger a full-screen pop
            fullScreenGestureEnabled: false,
            gestureEnabled: true,
          }}
        />
        {/* Singletons: re-open reuses the screen instead of stacking copies */}
        <Stack.Screen
          name="settings"
          options={{ title: "Settings", animation: "slide_from_right" }}
          getId={() => "settings"}
        />
        <Stack.Screen
          name="activity"
          options={{ title: "Activity", animation: "slide_from_right" }}
          getId={() => "activity"}
        />
        <Stack.Screen
          name="pack"
          options={{ title: "Pack", animation: "slide_from_right" }}
          getId={() => "pack"}
        />
        <Stack.Screen
          name="share"
          options={{ title: "Sync", animation: "slide_from_right" }}
          getId={() => "share"}
        />
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
