import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import webExtension from 'vite-plugin-web-extension';

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
  ],
  resolve: {
    extensions: ['.tsx', '.ts', '.jsx', '.js', '.json'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
