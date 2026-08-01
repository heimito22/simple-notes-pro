module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      'react-native-worklets/plugin', // OBRIGATÓRIO no Reanimated 4 (o plugin foi movido para react-native-worklets)
    ],
  };
};