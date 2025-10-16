import { defineConfig } from 'vite';
import webExtension from 'vite-plugin-web-extension';

export default defineConfig({
  plugins: [
    webExtension({
      manifest: './src/manifest.json',
      additionalInputs: [
        'src/popup/popup.html',
        'src/sidepanel/sidepanel.html',
      ],
    }),
  ],
  resolve: {
    extensions: ['.ts', '.js', '.json'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
