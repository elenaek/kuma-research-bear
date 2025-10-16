# Quick Start Guide

Get your Research Bear extension up and running in minutes!

## Step 1: Install Dependencies

```bash
npm install
```

## Step 2: Generate Icons

1. Open `public/icons/generate-icons.html` in your browser
2. Click each "Download" button to save the icons
3. The files will be saved to your Downloads folder
4. Move them to the `public/icons/` directory

Or create your own icons using [Icon Kitchen](https://icon.kitchen/).

## Step 3: Build the Extension

```bash
npm run build
```

This will create a `dist` folder with your built extension.

## Step 4: Enable Chrome AI

1. Download and install [Chrome Canary](https://www.google.com/chrome/canary/)
2. Open Chrome Canary
3. Navigate to `chrome://flags`
4. Search for and enable these flags:
   - `Prompt API for Gemini Nano` - Set to "Enabled"
   - `Optimization Guide On Device Model` - Set to "Enabled BypassPerfRequirement"
5. Restart Chrome Canary

## Step 5: Load the Extension

1. Open `chrome://extensions/` in Chrome Canary
2. Enable "Developer mode" (toggle in top-right)
3. Click "Load unpacked"
4. Select the `dist` folder from your project
5. The extension should now appear in your extensions list

## Step 6: Test It Out!

1. Navigate to a research paper:
   - Try: https://arxiv.org/abs/2301.00001
   - Or: https://pubmed.ncbi.nlm.nih.gov/

2. Click the Research Bear extension icon

3. Click "Detect Paper" - it should find the paper automatically

4. Click "Explain Paper" - the AI will generate a simple explanation

5. View the explanation in the sidepanel

## Development Mode

For active development with hot reload:

```bash
npm run dev
```

Then load the `dist` folder in Chrome. Changes will rebuild automatically.

## Troubleshooting

### "AI not available" message

- Make sure you're using Chrome Canary (not regular Chrome)
- Verify the AI flags are enabled at `chrome://flags`
- Restart Chrome after enabling flags
- Some systems may need to download the AI model first (this happens automatically)

### Extension icon doesn't appear

- Check that you've placed the icon files in `public/icons/`
- Rebuild the extension: `npm run build`
- Reload the extension at `chrome://extensions/`

### "No paper detected" message

- Make sure you're on a supported site (arXiv, PubMed, bioRxiv, etc.)
- Try refreshing the page
- Check the browser console for errors (F12)

### Changes not showing up

- If using `npm run dev`: Wait a few seconds for the rebuild
- If using `npm run build`: You need to rebuild manually
- Click the refresh icon on the extension card at `chrome://extensions/`

## Next Steps

- Read [CONTRIBUTING.md](./CONTRIBUTING.md) for development details
- Check out the [README.md](./README.md) for feature documentation
- Start customizing the prompts in `src/utils/aiService.ts`
- Add support for more paper sources in `src/utils/paperDetectors.ts`

## Common Tasks

### Add a new paper source

1. Edit `src/manifest.json` - add URL patterns
2. Edit `src/utils/paperDetectors.ts` - create detector function
3. Rebuild and test

### Customize AI prompts

Edit the system prompts in `src/utils/aiService.ts`:
- `explainAbstract()` - How abstracts are explained
- `generateSummary()` - How summaries are created
- `explainTerm()` - How terms are defined

### Change the UI theme

Edit the CSS files:
- `src/popup/popup.css` - Popup styling
- `src/sidepanel/sidepanel.css` - Sidepanel styling
- `src/content/content.css` - Content script styling

Happy hacking!
