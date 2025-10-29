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
    // Copy PDF.js worker, DotLottie WASM, ONNX Runtime WASM, and chatbox CSS to dist folder
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
        {
          src: 'src/content/components/chatbox.css',
          dest: 'src/content/components',
        },
        {
          src: 'src/content/styles/askKumaButton.css',
          dest: 'src/content/styles',
        },
        {
          src: 'src/content/styles/imageExplainButton.css',
          dest: 'src/content/styles',
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
    minify: 'terser',
    // Fix Chrome Windows UTF-8 encoding bug by escaping all Unicode characters
    terserOptions: {
      format: {
        ascii_only: true,
      },
    },
    // Disable polyfills that reference document
    modulePreload: {
      polyfill: false,
    },
    rollupOptions: {
      output: {
        // Prevent extremely long lines that Chrome on Windows can't parse
        compact: false,
        // Enforce readable formatting with proper line breaks
        generatedCode: {
          constBindings: true,
        },
      },
    },
  },
});
