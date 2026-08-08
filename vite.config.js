import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const root = resolve(import.meta.dirname);

function copyLegacyStaticFiles() {
  const paths = ['assets', 'css', 'js', 'locales', 'services', 'manifest.json', 'robots.txt', 'sitemap.xml', 'sw.js'];
  return {
    name: 'copy-legacy-static-files',
    closeBundle() {
      const output = resolve(root, 'dist');
      for (const relativePath of paths) {
        const source = resolve(root, relativePath);
        if (!existsSync(source)) continue;
        cpSync(source, resolve(output, relativePath), { recursive: true });
      }
    },
  };
}

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: resolve(root, 'index.html'),
        ventana: resolve(root, 'ventana.html'),
        guiaUsuario: resolve(root, 'guia-usuario.html'),
        offline: resolve(root, 'offline.html'),
      },
    },
  },
  plugins: [copyLegacyStaticFiles()],
});
