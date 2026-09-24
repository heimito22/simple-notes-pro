// Shim web de @react-native-google-signin/google-signin.
// No Electron o preload-webview expoe window.GoogleSignin antes do bundle.
// Aqui o Metro alias resolve este arquivo quando platform === 'web' — o
// bundle le o shim do preload via Proxy. Fora do Electron retorna stub.
function getImpl() {
  if (typeof window !== 'undefined' && window.GoogleSignin && window.GoogleSignin.signIn) return window.GoogleSignin;
  var notImpl = function () { return Promise.reject(new Error('Login Google disponivel apenas no app desktop.')); };
  return {
    configure: function () {},
    hasPlayServices: function () { return Promise.resolve(false); },
    signIn: notImpl,
    signInSilently: function () { return Promise.resolve(null); },
    getCurrentUser: function () { return Promise.resolve(null); },
    hasPreviousSignIn: function () { return false; },
    signOut: function () { return Promise.resolve(null); },
    revokeAccess: function () { return Promise.resolve(null); },
    clearCachedAccessToken: function () { return Promise.resolve(null); },
    addScopes: function () { return Promise.resolve(null); },
    getTokens: notImpl,
  };
}
var GoogleSigninProxy = new Proxy({}, {
  get: function (_t, prop) {
    var impl = getImpl();
    var v = impl[prop];
    return typeof v === 'function' ? v.bind(impl) : v;
  }
});
var statusCodes = { SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED', IN_PROGRESS: 'IN_PROGRESS', PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE', SIGN_IN_REQUIRED: 'SIGN_IN_REQUIRED' };
module.exports = { GoogleSignin: GoogleSigninProxy, statusCodes: statusCodes };
module.exports.GoogleSignin = GoogleSigninProxy;
module.exports.statusCodes = statusCodes;
module.exports.default = GoogleSigninProxy;
