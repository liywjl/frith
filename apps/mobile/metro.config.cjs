// .cjs because this package is ESM ("type": "module") and Expo's config
// loader expects a CommonJS Metro config. Expo SDK 53+ detects the pnpm
// monorepo on its own (workspace root watching, root node_modules) — no
// manual overrides needed. The worklet bundle (app.bundle.mjs) is plain JS;
// make sure .mjs resolves.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
if (!config.resolver.sourceExts.includes('mjs')) config.resolver.sourceExts.push('mjs');

module.exports = config;
