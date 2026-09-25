// Forge loads this configuration as CommonJS.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('node:path');

module.exports = {
  outDir: path.resolve(__dirname, '../electron'),
  packagerConfig: {
    name: 'LeetCode Tutor',
    executableName: 'LeetCode Tutor',
    appBundleId: 'io.github.pritanb.leetcode-tutor',
    appCategoryType: 'public.app-category.education',
    icon: path.join(__dirname, 'assets/icon.icns'),
    // Native embedding dependencies load sibling shared libraries outside ASAR.
    asar: { unpack: '**/node_modules/{@img,onnxruntime-node}/**' },
    // The staging directory is an explicit allowlist. Never package the checkout.
    ignore: [/^\/forge\.config\.cjs$/, /^\/package-lock\.json$/, /^\/\.installed-lock$/],
  },
  rebuildConfig: { onlyModules: ['better-sqlite3'] },
  makers: [{ name: '@electron-forge/maker-zip', platforms: ['darwin'] }],
  plugins: [{ name: '@electron-forge/plugin-auto-unpack-natives', config: {} }],
  hooks: {
    postPackage: async (_config, result) => {
      // Ad hoc signing supports local Apple silicon launches. It is not notarization.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { execFileSync } = require('node:child_process');
      for (const output of result.outputPaths) {
        execFileSync('codesign', ['--force', '--deep', '--sign', '-', path.join(output, 'LeetCode Tutor.app')], { stdio: 'inherit' });
      }
    },
  },
};
