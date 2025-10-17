import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import webExtension from 'vite-plugin-web-extension';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  plugins: [
    preact(),
    webExtension({
      manifest: './src/manifest.json',
      additionalInputs: [
        'src/popup/popup.html',
        'src/sidepanel/sidepanel.html',
      ],
    }),
    // Copy PDF.js worker to dist folder
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
          dest: '.',
        },
      ],
    }),
  ],
  resolve: {
    extensions: ['.tsx', '.ts', '.jsx', '.js', '.json'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
