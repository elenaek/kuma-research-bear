const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Source icon (use the 192px version as it has good quality)
const sourceIcon = path.join(__dirname, '../public/icons/icon-192.png');
const outputDir = path.join(__dirname, '../public/icons');

// Target sizes for Chrome extension
const sizes = [16, 32, 48, 128];

async function resizeIcons() {
  console.log('🎨 Generating Chrome extension icons...\n');

  // Check if source icon exists
  if (!fs.existsSync(sourceIcon)) {
    console.error('❌ Error: Source icon not found at:', sourceIcon);
    process.exit(1);
  }

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Resize to each target size
  for (const size of sizes) {
    const outputPath = path.join(outputDir, `icon${size}.png`);

    try {
      await sharp(sourceIcon)
        .resize(size, size, {
          kernel: sharp.kernel.lanczos3, // High-quality downscaling
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 } // Transparent background
        })
        .png()
        .toFile(outputPath);

      console.log(`✅ Created: icon${size}.png (${size}x${size})`);
    } catch (error) {
      console.error(`❌ Error creating icon${size}.png:`, error.message);
      process.exit(1);
    }
  }

  console.log('\n🎉 All icons generated successfully!');
  console.log(`📁 Location: ${outputDir}`);
}

// Run the script
resizeIcons().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});
