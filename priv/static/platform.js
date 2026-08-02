/**
 * keyverse platform bridge — desktop browser UX is the default.
 * Native Tauri (esp. mobile) only *adds* classes / flags; it never replaces
 * the responsive desktop layout at ≥641px unless the shell is truly mobile.
 *
 * Loaded early in <head> so first paint can use html.kv-* classes.
 */
(function () {
  var html = document.documentElement;
  var ua = navigator.userAgent || "";
  var isTauri = !!(
    window.__TAURI_INTERNALS__ ||
    window.__TAURI__ ||
    (ua.indexOf("Tauri") !== -1)
  );
  // iOS/Android WebView inside Tauri, or coarse + narrow as soft hint when flagged.
  var isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var isAndroid = /Android/i.test(ua);
  var isMobileUA = isIOS || isAndroid;
  var coarse = false;
  try {
    coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  } catch (e) {}
  var narrow = false;
  try {
    narrow = window.matchMedia && window.matchMedia("(max-width: 640px)").matches;
  } catch (e) {}

  var platform = "web";
  if (isTauri) {
    if (isIOS) platform = "tauri-ios";
    else if (isAndroid) platform = "tauri-android";
    else platform = "tauri-desktop";
  }

  window.KV_PLATFORM = {
    id: platform,
    isTauri: isTauri,
    isNativeMobile: isTauri && isMobileUA,
    isIOS: isIOS,
    isAndroid: isAndroid,
    // Prefer existing CSS breakpoints for layout; native only for chrome/safe-area.
    preferMobileChrome: isTauri && (isMobileUA || (coarse && narrow))
  };

  html.classList.add("kv-" + platform);
  html.dataset.platform = platform;
  if (isTauri) html.classList.add("kv-tauri");
  if (window.KV_PLATFORM.isNativeMobile) html.classList.add("kv-native-mobile");
  if (window.KV_PLATFORM.preferMobileChrome) html.classList.add("kv-native-chrome");

  // Standalone / installed PWA still uses existing rules; native shell skips install UI.
  if (isTauri) {
    html.classList.add("kv-no-pwa-install");
  }

  // Safe-area CSS variables (Tauri mobile webviews sometimes need a kick).
  function syncSafe() {
    // env() works when viewport-fit=cover is set (already in page shell).
    html.style.setProperty("--kv-sat", "env(safe-area-inset-top, 0px)");
    html.style.setProperty("--kv-sab", "env(safe-area-inset-bottom, 0px)");
    html.style.setProperty("--kv-sal", "env(safe-area-inset-left, 0px)");
    html.style.setProperty("--kv-sar", "env(safe-area-inset-right, 0px)");
  }
  syncSafe();
  window.addEventListener("resize", syncSafe, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", syncSafe, { passive: true });
  }
})();
