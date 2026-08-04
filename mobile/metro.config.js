const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const nm = path.resolve(projectRoot, "node_modules");
const config = getDefaultConfig(projectRoot);

config.resolver.assetExts = [...new Set([...(config.resolver.assetExts || []), "gz"])];
// Only resolve from mobile/node_modules (Expo was walking up to empty ../../../node_modules).
config.resolver.nodeModulesPaths = [nm];
config.resolver.disableHierarchicalLookup = true;
config.watchFolders = [projectRoot];
// Explicit pins for packages Metro has failed to resolve (Expo Go / pnpm)
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  "expo-blur": path.resolve(nm, "expo-blur"),
  "expo-haptics": path.resolve(nm, "expo-haptics"),
  "phosphor-react-native": path.resolve(nm, "phosphor-react-native"),
  "react-native-svg": path.resolve(nm, "react-native-svg"),
  "react-native-gesture-handler": path.resolve(nm, "react-native-gesture-handler"),
  qrcode: path.resolve(nm, "qrcode"),
  dijkstrajs: path.resolve(nm, "dijkstrajs"),
};

module.exports = config;
