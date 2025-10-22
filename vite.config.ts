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
        'src/offscreen/offscreen.html',
      ],
    }),
    // Copy PDF.js worker, DotLottie WASM, and ONNX Runtime WASM to dist folder
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
          dest: '.',
        },
        {
          src: 'node_modules/@lottiefiles/dotlottie-web/dist/dotlottie-player.wasm',
          dest: '.',
        },
        {
          src: 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded*.{wasm,mjs}',
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
    // Disable polyfills that reference document
    modulePreload: {
      polyfill: false,
    },
  },
});
