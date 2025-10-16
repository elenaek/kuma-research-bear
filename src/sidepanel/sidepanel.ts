// DOM elements
const loading = document.getElementById('loading') as HTMLElement;
const emptyState = document.getElementById('empty-state') as HTMLElement;
const content = document.getElementById('content') as HTMLElement;
const paperTitle = document.getElementById('paper-title') as HTMLElement;
const paperAuthors = document.getElementById('paper-authors') as HTMLElement;
const paperLink = document.getElementById('paper-link') as HTMLAnchorElement;
const summaryText = document.getElementById('summary-text') as HTMLElement;
const keyPoints = document.getElementById('key-points') as HTMLElement;
const explanationText = document.getElementById('explanation-text') as HTMLElement;
const originalText = document.getElementById('original-text') as HTMLElement;
const copyBtn = document.getElementById('copy-btn') as HTMLButtonElement;
const refreshBtn = document.getElementById('refresh-btn') as HTMLButtonElement;

// Tab switching
const tabs = document.querySelectorAll('.tab');
const tabPanels = document.querySelectorAll('.tab-panel');

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const targetTab = tab.getAttribute('data-tab');

    tabs.forEach(t => t.classList.remove('active'));
    tabPanels.forEach(p => p.classList.remove('active'));

    tab.classList.add('active');
    document.getElementById(`tab-${targetTab}`)?.classList.add('active');
  });
});

// Load explanation from storage
async function loadExplanation() {
  try {
    const result = await chrome.storage.local.get(['lastExplanation']);

    if (!result.lastExplanation) {
      showEmptyState();
      return;
    }

    const { paper, explanation, summary } = result.lastExplanation;

    // Populate paper info
    paperTitle.textContent = paper.title;
    paperAuthors.textContent = paper.authors.join(', ');
    paperLink.href = paper.url;

    // Populate summary
    summaryText.textContent = summary.summary;
    keyPoints.innerHTML = summary.keyPoints
      .map(point => `<li>${point}</li>`)
      .join('');

    // Populate explanation
    explanationText.textContent = explanation.explanation;

    // Populate original abstract
    originalText.textContent = paper.abstract;

    // Show content
    showContent();
  } catch (error) {
    console.error('Error loading explanation:', error);
    showEmptyState();
  }
}

function showEmptyState() {
  loading.classList.add('hidden');
  emptyState.classList.remove('hidden');
  content.classList.add('hidden');
}

function showContent() {
  loading.classList.add('hidden');
  emptyState.classList.add('hidden');
  content.classList.remove('hidden');
}

function showLoading() {
  loading.classList.remove('hidden');
  emptyState.classList.add('hidden');
  content.classList.add('hidden');
}

// Copy explanation
copyBtn.addEventListener('click', async () => {
  try {
    const result = await chrome.storage.local.get(['lastExplanation']);

    if (!result.lastExplanation) {
      alert('No explanation to copy');
      return;
    }

    const { paper, explanation, summary } = result.lastExplanation;

    const text = `
${paper.title}
${paper.authors.join(', ')}

SUMMARY:
${summary.summary}

KEY POINTS:
${summary.keyPoints.map(p => `- ${p}`).join('\n')}

EXPLANATION:
${explanation.explanation}

Source: ${paper.url}
    `.trim();

    await navigator.clipboard.writeText(text);

    const originalText = copyBtn.textContent;
    copyBtn.textContent = 'Copied!';
    setTimeout(() => {
      copyBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="2" y="2" width="10" height="10" stroke="currentColor" stroke-width="2"/>
          <path d="M4 14h10V4" stroke="currentColor" stroke-width="2"/>
        </svg>
        Copy Explanation
      `;
    }, 2000);
  } catch (error) {
    console.error('Error copying:', error);
    alert('Failed to copy explanation');
  }
});

// Regenerate explanation
refreshBtn.addEventListener('click', async () => {
  try {
    const result = await chrome.storage.local.get(['currentPaper']);

    if (!result.currentPaper) {
      alert('No paper found. Please detect a paper first.');
      return;
    }

    showLoading();

    // Send message to background to regenerate
    const response = await chrome.runtime.sendMessage({
      type: 'EXPLAIN_PAPER',
      payload: { paper: result.currentPaper },
    });

    if (response.success) {
      // Reload the explanation
      await loadExplanation();
    } else {
      alert('Failed to regenerate explanation');
      showEmptyState();
    }
  } catch (error) {
    console.error('Error regenerating:', error);
    alert('Failed to regenerate explanation');
    showEmptyState();
  }
});

// Listen for storage changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.lastExplanation) {
    loadExplanation();
  }
});

// Initialize
loadExplanation();
