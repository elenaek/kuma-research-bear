import { ResearchPaper, PaperSection } from '../types/index.ts';

// Detector for arXiv papers
export function detectArXivPaper(): ResearchPaper | null {
  const url = window.location.href;

  if (!url.includes('arxiv.org')) return null;

  try {
    const title = document.querySelector('h1.title')?.textContent?.replace('Title:', '').trim() || '';
    const authors = Array.from(document.querySelectorAll('.authors a'))
      .map(el => el.textContent?.trim() || '')
      .filter(Boolean);

    const abstractBlock = document.querySelector('.abstract');
    const abstract = abstractBlock?.textContent?.replace('Abstract:', '').trim() || '';

    // Extract arXiv ID
    const arxivIdMatch = url.match(/arxiv\.org\/(abs|pdf)\/(\d+\.\d+)/);
    const arxivId = arxivIdMatch ? arxivIdMatch[2] : '';

    return {
      title,
      authors,
      abstract,
      url,
      source: 'arxiv',
      metadata: {
        arxivId,
        pdfUrl: `https://arxiv.org/pdf/${arxivId}.pdf`,
      },
    };
  } catch (error) {
    console.error('Error detecting arXiv paper:', error);
    return null;
  }
}

// Detector for PubMed papers
export function detectPubMedPaper(): ResearchPaper | null {
  const url = window.location.href;

  if (!url.includes('pubmed.ncbi.nlm.nih.gov') && !url.includes('ncbi.nlm.nih.gov/pmc')) return null;

  try {
    const title = document.querySelector('h1.heading-title')?.textContent?.trim() ||
                  document.querySelector('.article-title')?.textContent?.trim() || '';

    const authors = Array.from(document.querySelectorAll('.authors-list button, .contrib-group a'))
      .map(el => el.textContent?.trim() || '')
      .filter(Boolean);

    const abstract = document.querySelector('#abstract .abstract-content')?.textContent?.trim() ||
                    document.querySelector('#enc-abstract')?.textContent?.trim() || '';

    // Extract DOI
    const doiElement = document.querySelector('[data-doi]');
    const doi = doiElement?.getAttribute('data-doi') || '';

    return {
      title,
      authors,
      abstract,
      url,
      source: 'pubmed',
      metadata: {
        doi,
      },
    };
  } catch (error) {
    console.error('Error detecting PubMed paper:', error);
    return null;
  }
}

// Detector for bioRxiv/medRxiv papers
export function detectBioRxivPaper(): ResearchPaper | null {
  const url = window.location.href;

  if (!url.includes('biorxiv.org') && !url.includes('medrxiv.org')) return null;

  try {
    const title = document.querySelector('h1#page-title')?.textContent?.trim() || '';

    const authors = Array.from(document.querySelectorAll('.highwire-citation-author'))
      .map(el => el.textContent?.trim() || '')
      .filter(Boolean);

    const abstract = document.querySelector('#abstract-1 p')?.textContent?.trim() ||
                    document.querySelector('.abstract')?.textContent?.trim() || '';

    // Extract DOI
    const doiMatch = url.match(/10\.\d+\/[^\s]+/);
    const doi = doiMatch ? doiMatch[0] : '';

    return {
      title,
      authors,
      abstract,
      url,
      source: 'biorxiv',
      metadata: {
        doi,
      },
    };
  } catch (error) {
    console.error('Error detecting bioRxiv paper:', error);
    return null;
  }
}

// Generic detector for papers with schema.org markup
export function detectSchemaOrgPaper(): ResearchPaper | null {
  try {
    const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');

    for (const script of jsonLdScripts) {
      const data = JSON.parse(script.textContent || '{}');

      if (data['@type'] === 'ScholarlyArticle' || data['@type'] === 'Article') {
        const authors = Array.isArray(data.author)
          ? data.author.map((a: any) => a.name || '')
          : [data.author?.name || ''];

        return {
          title: data.headline || data.name || '',
          authors: authors.filter(Boolean),
          abstract: data.description || '',
          url: window.location.href,
          source: 'other',
          metadata: {
            doi: data.doi || '',
            publishDate: data.datePublished || '',
          },
        };
      }
    }

    return null;
  } catch (error) {
    console.error('Error detecting schema.org paper:', error);
    return null;
  }
}

// Main detector function that tries all detectors
export function detectPaper(): ResearchPaper | null {
  const detectors = [
    detectArXivPaper,
    detectPubMedPaper,
    detectBioRxivPaper,
    detectSchemaOrgPaper,
  ];

  for (const detector of detectors) {
    const paper = detector();
    if (paper) {
      console.log('Paper detected:', paper);
      return paper;
    }
  }

  return null;
}
