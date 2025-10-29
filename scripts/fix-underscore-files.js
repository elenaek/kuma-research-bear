import { readdirSync, renameSync, statSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * Step 1: Rename files starting with underscore
 */
function renameUnderscoreFiles(dir) {
  const items = readdirSync(dir);

  items.forEach(item => {
    const fullPath = join(dir, item);
    const stat = statSync(fullPath);

    // Recursively process subdirectories
    if (stat.isDirectory()) {
      renameUnderscoreFiles(fullPath);
    }
    // Rename JS files starting with underscore
    else if (item.startsWith('_') && item.endsWith('.js')) {
      const newName = item.slice(1);
      const newPath = join(dir, newName);
      renameSync(fullPath, newPath);
      console.log(`✓ Renamed ${item} → ${newName}`);
    }
  });
}

/**
 * Step 2: Fix import references in all JS files
 * Replace imports like "./_commonjsHelpers.js" with "./commonjsHelpers.js"
 */
function fixImportReferences(dir) {
  const items = readdirSync(dir);

  items.forEach(item => {
    const fullPath = join(dir, item);
    const stat = statSync(fullPath);

    // Recursively process subdirectories
    if (stat.isDirectory()) {
      fixImportReferences(fullPath);
    }
    // Fix imports in JS files
    else if (item.endsWith('.js')) {
      let content = readFileSync(fullPath, 'utf8');
      const originalContent = content;

      // Pattern: Replace underscore-prefixed filenames in import paths
      // This handles ALL variations:
      // - "./_file.js" -> "./file.js"
      // - "../../_file.js" -> "../../file.js"
      // - "_file.js" -> "file.js"
      // Match: (quote)(optional path)(forward slash OR start)(underscore)(filename)(quote)
      content = content.replace(
        /(["'])((\.\.\/|\.\/)*)?_([^"'\/]+\.js)(["'])/g,
        '$1$2$4$5'
      );

      // Only write if content changed
      if (content !== originalContent) {
        writeFileSync(fullPath, content, 'utf8');
        console.log(`✓ Fixed imports in ${fullPath.replace(/.*[\\/]dist[\\/]/, 'dist/')}`);
      }
    }
  });
}

console.log('=== Step 1: Renaming underscore-prefixed files ===');
renameUnderscoreFiles('dist');
console.log('✓ All underscore files renamed!\n');

console.log('=== Step 2: Fixing import references ===');
fixImportReferences('dist');
console.log('✓ All import references fixed!');
