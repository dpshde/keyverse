import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  DarkTheme as NavDark,
  DefaultTheme as NavLight,
  type Theme as NavTheme,
} from "@react-navigation/native";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Appearance, useColorScheme } from "react-native";
import {
  getColors,
  makeType,
  makeUi,
  resolveScheme,
  type ThemeColors,
  type ThemePreference,
  type ThemeScheme,
  type TypeStyles,
} from "../theme";

const THEME_KEY = "kv.theme";

type UiStyles = ReturnType<typeof makeUi>;

type ThemeContextValue = {
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
  resolved: ThemeScheme;
  colors: ThemeColors;
  /** Alias for colors — shorter at call sites */
  color: ThemeColors;
  ui: UiStyles;
  type: TypeStyles;
  navTheme: NavTheme;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function buildNavTheme(scheme: ThemeScheme, c: ThemeColors): NavTheme {
  const base = scheme === "dark" ? NavDark : NavLight;
  return {
    ...base,
    dark: scheme === "dark",
    colors: {
      ...base.colors,
      primary: c.ink,
      background: c.paper,
      // Same paper as the page — continuous field, not pure-white raised card.
      // (Fully transparent + content-under-header collided with titles/verse text.)
      card: c.paper,
      text: c.ink,
      border: c.lineSoft,
      notification: c.danger,
    },
  };
}

function parsePreference(raw: string | null): ThemePreference {
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  return "system";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(THEME_KEY);
        if (!cancelled) setPreferenceState(parsePreference(raw));
      } catch {
        /* keep default */
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setPreference = useCallback((p: ThemePreference) => {
    setPreferenceState(p);
    void AsyncStorage.setItem(THEME_KEY, p).catch(() => {});
  }, []);

  const system: ThemeScheme = systemScheme === "dark" ? "dark" : "light";
  const resolved = resolveScheme(preference, system);
  const colors = useMemo(() => getColors(resolved), [resolved]);
  const ui = useMemo(() => makeUi(colors), [colors]);
  const type = useMemo(() => makeType(colors), [colors]);
  const navTheme = useMemo(() => buildNavTheme(resolved, colors), [resolved, colors]);

  // Keep Appearance in sync when preference is locked (helps some native chrome)
  useEffect(() => {
    if (!ready) return;
    const setScheme = Appearance.setColorScheme;
    if (typeof setScheme !== "function") return;
    if (preference === "system") {
      setScheme(null);
    } else {
      setScheme(preference);
    }
  }, [preference, ready]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      setPreference,
      resolved,
      colors,
      color: colors,
      ui,
      type,
      navTheme,
    }),
    [preference, setPreference, resolved, colors, ui, type, navTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}
