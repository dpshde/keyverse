import { Redirect } from "expo-router";

/** Pack screen folded into Settings (local-first + cloud). */
export default function PackRedirect() {
  return <Redirect href="/settings" />;
}
