/**
 * Image Detection Service
 * Detects relevant images in research papers for explanation
 * Filters out small icons, navigation images, and other non-content images
 */

export interface DetectedImage {
  element: HTMLImageElement;
  url: string;
  width: number;
  height: number;
  alt?: string;
  context?: string; // Nearby text (caption, surrounding paragraph)
}

// Minimum dimensions for images to be considered for explanation
const MIN_IMAGE_WIDTH = 100;
const MIN_IMAGE_HEIGHT = 100;

// Selectors for main content areas in common academic sites
const MAIN_CONTENT_SELECTORS = [
  'main',
  'article',
  '[role="main"]',
  '.content',
  '.article-content',
  '.paper-content',
  '#content',
  '#main',
  '.main-content',
  // ArXiv specific
  '#abs',
  '.ltx_page_main',
  // PubMed specific
  '.article-details',
  '.full-text',
  // BioRxiv specific
  '.article',
  '.highwire-article',
];

// Selectors to exclude (navigation, headers, ads, etc.)
const EXCLUDE_SELECTORS = [
  'nav',
  'header',
  'footer',
  'aside',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '[role="complementary"]',
  '.nav',
  '.navigation',
  '.header',
  '.footer',
  '.sidebar',
  '.menu',
  '.ad',
  '.advertisement',
  '.banner',
  '.logo',
  // Exclude small icon/button images
  'button img',
  'a[href] img[width="16"]',
  'a[href] img[width="20"]',
  'a[href] img[width="24"]',
  'a[href] img[width="32"]',
];

/**
 * Check if an element is within an excluded area
 */
function isInExcludedArea(element: HTMLElement): boolean {
  for (const selector of EXCLUDE_SELECTORS) {
    if (element.closest(selector)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if an image meets the minimum size requirements
 */
function meetsMinimumSize(img: HTMLImageElement): boolean {
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;

  return width >= MIN_IMAGE_WIDTH && height >= MIN_IMAGE_HEIGHT;
}

/**
 * Get context text around an image (captions, nearby paragraphs)
 */
function getImageContext(img: HTMLImageElement): string {
  const contexts: string[] = [];

  // Check for figure caption
  const figure = img.closest('figure');
  if (figure) {
    const figcaption = figure.querySelector('figcaption');
    if (figcaption) {
      contexts.push(figcaption.textContent?.trim() || '');
    }
  }

  // Check for nearby caption elements
  const parent = img.parentElement;
  if (parent) {
    const caption = parent.querySelector('.caption, .figure-caption, [class*="caption"]');
    if (caption) {
      contexts.push(caption.textContent?.trim() || '');
    }
  }

  // Get surrounding paragraph text (max 200 chars)
  const nearbyParagraph = img.closest('p') ||
                          img.parentElement?.querySelector('p');
  if (nearbyParagraph) {
    const text = nearbyParagraph.textContent?.trim() || '';
    contexts.push(text.substring(0, 200));
  }

  return contexts.filter(c => c.length > 0).join(' | ');
}

/**
 * Normalize image URL to absolute URL
 */
function normalizeImageUrl(img: HTMLImageElement): string {
  const src = img.src || img.getAttribute('src') || '';

  // Handle data URLs
  if (src.startsWith('data:')) {
    return src;
  }

  // Convert to absolute URL
  try {
    return new URL(src, window.location.href).href;
  } catch (e) {
    return src;
  }
}

/**
 * Find the main content area of the page
 */
function findMainContent(): HTMLElement | null {
  // Try each selector in order
  for (const selector of MAIN_CONTENT_SELECTORS) {
    const element = document.querySelector(selector);
    if (element) {
      return element as HTMLElement;
    }
  }

  // Fallback to body if no main content found
  return document.body;
}

/**
 * Detect all relevant images in the document
 */
export function detectImages(): DetectedImage[] {
  console.log('[ImageDetect] Starting image detection...');

  const mainContent = findMainContent();
  if (!mainContent) {
    console.log('[ImageDetect] No main content area found');
    return [];
  }

  console.log('[ImageDetect] Main content element:', mainContent.tagName, mainContent.className);

  // Get all images in main content
  const allImages = Array.from(mainContent.querySelectorAll('img')) as HTMLImageElement[];
  console.log('[ImageDetect] Found', allImages.length, 'total images in main content');

  // Filter images
  const detectedImages: DetectedImage[] = [];

  for (const img of allImages) {
    // Skip if in excluded area
    if (isInExcludedArea(img)) {
      console.log('[ImageDetect] Skipping image in excluded area:', img.src);
      continue;
    }

    // Skip if too small
    if (!meetsMinimumSize(img)) {
      console.log('[ImageDetect] Skipping small image:', img.src,
                  `(${img.naturalWidth}x${img.naturalHeight})`);
      continue;
    }

    // Skip if hidden
    const style = window.getComputedStyle(img);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      console.log('[ImageDetect] Skipping hidden image:', img.src);
      continue;
    }

    // Get image details
    const url = normalizeImageUrl(img);
    const context = getImageContext(img);

    const detectedImage: DetectedImage = {
      element: img,
      url,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      alt: img.alt,
      context,
    };

    detectedImages.push(detectedImage);
    console.log('[ImageDetect] ✓ Detected relevant image:', url,
                `(${detectedImage.width}x${detectedImage.height})`);
  }

  console.log('[ImageDetect] Detected', detectedImages.length, 'relevant images');
  return detectedImages;
}

/**
 * Convert image element to Blob for AI processing
 */
export async function imageElementToBlob(img: HTMLImageElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    // Create a canvas to draw the image
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('Failed to get canvas context'));
      return;
    }

    // Handle cross-origin images
    const tempImg = new Image();
    tempImg.crossOrigin = 'anonymous';

    tempImg.onload = () => {
      ctx.drawImage(tempImg, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to convert image to blob'));
        }
      }, 'image/png');
    };

    tempImg.onerror = () => {
      // If cross-origin fails, try direct conversion
      try {
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to convert image to blob'));
          }
        }, 'image/png');
      } catch (error) {
        reject(error);
      }
    };

    tempImg.src = img.src;
  });
}

/**
 * Watch for dynamically added images
 */
export function watchForNewImages(callback: (images: DetectedImage[]) => void): MutationObserver {
  const observer = new MutationObserver((mutations) => {
    let hasNewImages = false;

    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        const addedNodes = Array.from(mutation.addedNodes);
        for (const node of addedNodes) {
          if (node instanceof HTMLImageElement ||
              (node instanceof HTMLElement && node.querySelector('img'))) {
            hasNewImages = true;
            break;
          }
        }
      }
    }

    if (hasNewImages) {
      console.log('[ImageDetect] New images detected, re-scanning...');
      const images = detectImages();
      callback(images);
    }
  });

  const mainContent = findMainContent();
  if (mainContent) {
    observer.observe(mainContent, {
      childList: true,
      subtree: true,
    });
  }

  return observer;
}
