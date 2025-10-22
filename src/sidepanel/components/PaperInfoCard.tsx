import { ExternalLink, Database, Clock, Calendar, BookOpen, Hash, Download, Globe } from 'lucide-preact';
import { ResearchPaper, StoredPaper, SUPPORTED_LANGUAGES } from '../../types/index.ts';

interface PaperInfoCardProps {
  paper: ResearchPaper | null;
  storedPaper: StoredPaper | null;
}

/**
 * Helper function to get language display name from language code
 */
function getLanguageName(code: string): string {
  const language = SUPPORTED_LANGUAGES.find(lang => lang.code === code);
  return language ? language.nativeName : code.toUpperCase();
}

/**
 * Paper Info Card Component
 * Displays paper metadata, badges, storage info, and action links
 */
export function PaperInfoCard(props: PaperInfoCardProps) {
  const { paper, storedPaper } = props;

  if (!paper) {
    return null;
  }

  const hasDetailedMetadata = !!paper.metadata && (
    paper.metadata.publishDate ||
    paper.metadata.journal ||
    paper.metadata.venue ||
    paper.metadata.doi ||
    paper.metadata.arxivId ||
    paper.metadata.pmid
  );

  return (
    <div class="card mb-4 sm:mb-6 animate-slide-in-up">
      {/* Title and Badges */}
      <div class="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4 mb-3">
        <h2 class="text-responsive-lg font-semibold text-gray-900 flex-1 min-w-0">{paper.title}</h2>
        <div class="flex gap-2 flex-wrap sm:shrink-0">
          {hasDetailedMetadata && (
            <span class="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-700 capitalize animate-fade-in whitespace-nowrap" style={{ animationDelay: '100ms' }}>
              {paper.source.replace('-', ' ')}
            </span>
          )}
          {storedPaper && (
            <span class="px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-700 flex items-center gap-1 animate-scale-in whitespace-nowrap" style={{ animationDelay: '150ms' }}>
              <Database size={12} />
              Stored
            </span>
          )}
        </div>
      </div>

      {/* Authors */}
      <p class="text-responsive-sm text-gray-600 mb-3 sm:mb-4">{paper.authors.join(', ')}</p>

      {/* Metadata Grid */}
      {(paper.metadata || storedPaper) && (
        <div class="grid grid-cols-1 gap-2 mb-4 pb-4 border-b border-gray-200">
          {/* Storage Info */}
          {storedPaper && (
            <>
              <div class="flex items-center gap-2 text-sm text-gray-700">
                <Clock size={14} class="text-gray-400" />
                <span class="font-medium">Stored:</span>
                <span>{new Date(storedPaper.storedAt).toLocaleString()}</span>
              </div>
              <div class="flex items-center gap-2 text-sm text-gray-700">
                <Database size={14} class="text-gray-400" />
                <span class="font-medium">Chunks:</span>
                <span>{storedPaper.chunkCount} content chunks for Q&A</span>
              </div>
            </>
          )}

          {/* Language Info */}
          {paper.metadata?.originalLanguage && (
            <div class="flex items-center gap-2 text-sm text-gray-700">
              <Globe size={14} class="text-gray-400" />
              <span class="font-medium">Original Language:</span>
              <span>{getLanguageName(paper.metadata.originalLanguage)}</span>
            </div>
          )}
          {paper.metadata?.outputLanguage && (
            <div class="flex items-center gap-2 text-sm text-gray-700">
              <Globe size={14} class="text-gray-400" />
              <span class="font-medium">Output Language:</span>
              <span>{getLanguageName(paper.metadata.outputLanguage)}</span>
            </div>
          )}

          {paper.metadata && (
            <>
              {/* Publication Date */}
              {paper.metadata.publishDate && (
                <div class="flex items-center gap-2 text-sm text-gray-700">
                  <Calendar size={14} class="text-gray-400" />
                  <span class="font-medium">Published:</span>
                  <span>{new Date(paper.metadata.publishDate).toLocaleDateString()}</span>
                </div>
              )}

              {/* Journal/Venue */}
              {(paper.metadata.journal || paper.metadata.venue) && (
                <div class="flex items-center gap-2 text-sm text-gray-700">
                  <BookOpen size={14} class="text-gray-400" />
                  <span class="font-medium">Published in:</span>
                  <span>{paper.metadata.journal || paper.metadata.venue}</span>
                </div>
              )}

              {/* DOI */}
              {paper.metadata.doi && (
                <div class="flex items-center gap-2 text-sm text-gray-700">
                  <Hash size={14} class="text-gray-400" />
                  <span class="font-medium">DOI:</span>
                  <a
                    href={`https://doi.org/${paper.metadata.doi}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-gray-600 hover:text-gray-700 hover:underline"
                  >
                    {paper.metadata.doi}
                  </a>
                </div>
              )}

              {/* arXiv ID */}
              {paper.metadata.arxivId && (
                <div class="flex items-center gap-2 text-sm text-gray-700">
                  <Hash size={14} class="text-gray-400" />
                  <span class="font-medium">arXiv:</span>
                  <a
                    href={`https://arxiv.org/abs/${paper.metadata.arxivId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-gray-600 hover:text-gray-700 hover:underline"
                  >
                    {paper.metadata.arxivId}
                  </a>
                </div>
              )}

              {/* PubMed IDs */}
              {paper.metadata.pmid && (
                <div class="flex items-center gap-2 text-sm text-gray-700">
                  <Hash size={14} class="text-gray-400" />
                  <span class="font-medium">PMID:</span>
                  <a
                    href={`https://pubmed.ncbi.nlm.nih.gov/${paper.metadata.pmid}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-gray-600 hover:text-gray-700 hover:underline"
                  >
                    {paper.metadata.pmid}
                  </a>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Action Links */}
      <div class="flex flex-col xs:flex-row gap-2 xs:gap-3">
        <a
          href={paper.url}
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center gap-1 text-responsive-sm text-gray-600 hover:text-blue-600 font-medium"
          style={{
            transition: 'all var(--duration-normal) var(--ease-out)',
          }}
          onMouseEnter={(e) => {
            const icon = e.currentTarget.querySelector('svg');
            if (icon) {
              (icon as SVGElement).style.transform = 'translateX(2px) translateY(-2px)';
            }
          }}
          onMouseLeave={(e) => {
            const icon = e.currentTarget.querySelector('svg');
            if (icon) {
              (icon as SVGElement).style.transform = 'translateX(0) translateY(0)';
            }
          }}
        >
          <ExternalLink
            size={14}
            style={{ transition: 'transform var(--duration-normal) var(--ease-out)' }}
          />
          {hasDetailedMetadata ? 'View Original' : 'View Original Paper'}
        </a>

        {paper.metadata?.pdfUrl && (
          <a
            href={paper.metadata.pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 text-responsive-sm text-gray-600 hover:text-blue-600 font-medium"
            style={{
              transition: 'all var(--duration-normal) var(--ease-out)',
            }}
            onMouseEnter={(e) => {
              const icon = e.currentTarget.querySelector('svg');
              if (icon) {
                (icon as SVGElement).style.transform = 'translateY(-2px)';
              }
            }}
            onMouseLeave={(e) => {
              const icon = e.currentTarget.querySelector('svg');
              if (icon) {
                (icon as SVGElement).style.transform = 'translateY(0)';
              }
            }}
          >
            <Download
              size={14}
              style={{ transition: 'transform var(--duration-normal) var(--ease-out)' }}
            />
            Download PDF
          </a>
        )}
      </div>
    </div>
  );
}
