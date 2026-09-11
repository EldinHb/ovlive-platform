module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // Must stay last: reanimated (which @gorhom/bottom-sheet drives) rewrites worklets.
    plugins: ["react-native-worklets/plugin"],
  };
};
