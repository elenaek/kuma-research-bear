const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Configuration for icon variants
const ICON_SIZES = [16, 32, 48, 128];
const VARIANTS = {
  detecting: { color: '#3B82F6', label: 'Detecting' },    // Blue
  explaining: { color: '#9c6640', label: 'Explaining' },  // Brown
  analyzing: { color: '#F97316', label: 'Analyzing' },     // Orange
  stored: { color: '#13bd2a', label: 'Stored' }           // Green
};

// Indicator dot position and size relative to icon size
const INDICATOR_CONFIG = {
  16: { radius: 2, offset: 1 },
  32: { radius: 3, offset: 3 },
  48: { radius: 7, offset: 4 },
  128: { radius: 15, offset: 10 }
};

async function generateIconVariant(inputPath, outputPath, size, color) {
  try {
    const config = INDICATOR_CONFIG[size];
    const dotRadius = config.radius;
    const dotOffset = config.offset;

    // Position indicator in bottom-right corner
    const dotX = size - dotOffset - dotRadius;
    const dotY = size - dotOffset - dotRadius;

    // Create SVG for the indicator dot with white background
    const indicatorSvg = Buffer.from(`
      <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
        <!-- White background circle for contrast -->
        <circle cx="${dotX}" cy="${dotY}" r="${dotRadius + 1}" fill="white"/>
        <!-- Colored indicator dot -->
        <circle cx="${dotX}" cy="${dotY}" r="${dotRadius}" fill="${color}"/>
      </svg>
    `);

    // Load original icon and composite the indicator on top
    await sharp(inputPath)
      .composite([
        {
          input: indicatorSvg,
          top: 0,
          left: 0,
        },
      ])
      .toFile(outputPath);

    console.log(`✓ Generated: ${outputPath}`);
  } catch (error) {
    console.error(`✗ Error generating ${outputPath}:`, error.message);
  }
}

async function generateAllVariants() {
  const iconsDir = path.join(__dirname, '..', 'public', 'icons');

  // Check if icons directory exists
  if (!fs.existsSync(iconsDir)) {
    console.error('Icons directory not found:', iconsDir);
    return;
  }

  console.log('Starting icon variant generation...\n');

  for (const [variantName, config] of Object.entries(VARIANTS)) {
    console.log(`Generating ${config.label} icons...`);

    for (const size of ICON_SIZES) {
      const inputFile = path.join(iconsDir, `icon${size}.png`);
      const outputFile = path.join(iconsDir, `icon-${variantName}-${size}.png`);

      // Check if source icon exists
      if (!fs.existsSync(inputFile)) {
        console.warn(`⚠ Source icon not found: ${inputFile}`);
        continue;
      }

      await generateIconVariant(inputFile, outputFile, size, config.color);
    }

    console.log('');
  }

  console.log('Icon generation complete!');
}

// Run the script
generateAllVariants().catch(console.error);