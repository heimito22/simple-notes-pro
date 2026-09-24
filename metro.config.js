// Simple Notes Pro — alias para web: o @react-native-google-signin não tem
// implementação web (joga "not-implemented"). No desktop (Electron) o login
// é feito via OAuth loopback nativo (google-auth.js) exposto no preload do
// webview como window.GoogleSignin antes do bundle rodar. Este alias garante
// que o bundle web importe nosso shim em vez do stub, sem tocar em node_modules.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Quando a plataforma é web, troca o módulo do google-signin pelo shim
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    platform === 'web' &&
    (moduleName === '@react-native-google-signin/google-signin' ||
      moduleName.startsWith('@react-native-google-signin/google-signin/'))
  ) {
    return {
      filePath: path.resolve(__dirname, 'shims/google-signin-web.js'),
      type: 'sourceFile',
    };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
