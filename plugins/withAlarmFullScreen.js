// Config plugin do Expo: garante que a MainActivity tenha
// android:showWhenLocked="true" e android:turnScreenOn="true".
//
// Sem isso, quando o alarme abre o app (via fullScreenIntent ou startActivity
// direto) com o celular bloqueado/desligado, a tela pode ficar atrás do
// keyguard ou nem ligar — principalmente em ROMs como MIUI/HyperOS.
const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withAlarmFullScreen(config) {
  return withAndroidManifest(config, (config) => {
    const app = config.modResults.manifest.application?.[0];
    if (!app) return config;

    const activities = app.activity || [];
    for (const activity of activities) {
      const nome = activity.$?.['android:name'] || '';
      if (nome === '.MainActivity' || nome.endsWith('.MainActivity')) {
        activity.$['android:showWhenLocked'] = 'true';
        activity.$['android:turnScreenOn'] = 'true';
      }
    }
    return config;
  });
};
