import { build } from 'esbuild';
import { createPluginBundlerPresets } from '@paperclipai/plugin-sdk/bundlers';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const presets = createPluginBundlerPresets({
  workerEntry: 'src/worker.mjs', manifestEntry: 'src/manifest.mjs',
  uiEntry: 'src/ui/index.tsx', sourcemap: false,
}).esbuild;
const nodeOptions = {
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
};
const licenses = new Map();
for (const options of [
  presets.manifest,
  { ...presets.worker, ...nodeOptions },
  { ...presets.ui, jsx: 'automatic' },
  { ...presets.worker, ...nodeOptions, entryPoints: ['src/bridge.mjs'], outExtension: { '.js': '.mjs' } },
]) {
  const result = await build({ ...options, metafile: true, legalComments: 'linked' });
  for (const input of Object.keys(result.metafile.inputs).filter(p => p.includes('node_modules/'))) {
    let directory = dirname(resolve(input));
    while (directory !== dirname(directory)) {
      const manifest = join(directory, 'package.json');
      const pkg = existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')) : {};
      if (pkg.name) {
        if (!licenses.has(pkg.name)) {
          const files = readdirSync(directory).filter(name => /^(licen[sc]e|copying)(\..*)?$/i.test(name));
          if (!files.length) throw new Error(`Missing bundled license for ${pkg.name}`);
          licenses.set(pkg.name, `## ${pkg.name}@${pkg.version}\n\n${files.map(name => readFileSync(join(directory, name), 'utf8')).join('\n')}`);
        }
        break;
      }
      directory = dirname(directory);
    }
  }
}
writeFileSync('THIRD_PARTY_NOTICES.md', '# Bundled dependency licenses\n\n' + [...licenses].sort(([a], [b]) => a.localeCompare(b)).map(([, text]) => text).join('\n\n'));
console.log('Built manifest, worker, UI, MCP bridge and dependency notices');
