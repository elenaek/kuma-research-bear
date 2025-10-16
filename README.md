# Research Bear - Research Paper Explainer

A Chrome extension that explains research papers using Chrome's built-in AI capabilities.

## Features

- Automatically detects research papers from popular sites (arXiv, PubMed, bioRxiv, etc.)
- Simplifies complex academic language
- Generates key takeaways
- Explains technical terms
- Interactive Q&A about papers

## Setup

1. Install dependencies:
```bash
npm install
```

2. Build the extension:
```bash
npm run build
```

3. Load in Chrome:
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dist` folder

## Development

Run in development mode with hot reload:
```bash
npm run dev
```

## Icons

Place icon files in `public/icons/`:
- icon16.png (16x16)
- icon32.png (32x32)
- icon48.png (48x48)
- icon128.png (128x128)

## Project Structure

```
kuma-research-bear/
├── src/
│   ├── background/       # Background service worker
│   ├── content/          # Content scripts
│   ├── popup/            # Extension popup UI
│   ├── sidepanel/        # Sidepanel UI
│   ├── styles/           # Shared styles
│   ├── utils/            # Utility functions
│   ├── types/            # TypeScript type definitions
│   └── manifest.json     # Extension manifest
├── public/               # Static assets
└── dist/                 # Build output
```

## License

MIT
