import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useSession } from "@/src/context/SessionContext";
import { useTheme } from "@/src/context/ThemeContext";

/** Local-first: no door gate — open the pack immediately (no push animation). */
export default function Index() {
  const { ready } = useSession();
  const { color } = useTheme();
  if (!ready) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: color.paper,
        }}
      >
        <ActivityIndicator color={color.muted} />
      </View>
    );
  }
  // Replace, not push — avoid a visible stack hop index → home
  return <Redirect href="/home" />;
}
