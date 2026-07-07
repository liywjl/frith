// .cjs for the same reason as metro.config.cjs: the package is ESM.
module.exports = function (api) {
  api.cache(true);
  return { presets: ['babel-preset-expo'] };
};
