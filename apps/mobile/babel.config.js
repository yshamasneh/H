// Needed by jest-expo (babel-jest) to transform the app + RN modules for the
// React Native Testing Library suite. Metro already applies babel-preset-expo
// implicitly for the app build; declaring it here makes the same transform
// available to Jest without changing how the app itself is bundled.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"]
  };
};
