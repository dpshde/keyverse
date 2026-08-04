import { Link, Stack } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/src/context/ThemeContext";

export default function NotFoundScreen() {
  const { colors: c, ui } = useTheme();
  return (
    <>
      <Stack.Screen options={{ title: "Missing" }} />
      <View style={[styles.container, { backgroundColor: c.paper }]}>
        <Text style={[styles.title, { color: c.ink }]}>Screen not found</Text>
        <Link href="/" style={styles.link}>
          <Text style={ui.link}>Home</Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20 },
  title: { fontSize: 18, fontWeight: "700" },
  link: { marginTop: 16 },
});
