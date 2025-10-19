import { ExternalLink, Database, Clock, Calendar, BookOpen, Hash, Download } from 'lucide-preact';
import { ResearchPaper, StoredPaper } from '../../types/index.ts';

interface PaperInfoCardProps {
  paper: ResearchPaper | null;
  storedPaper: StoredPaper | null;
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
    <div class="card mb-6">
      {/* Title and Badges */}
      <div class="flex items-start justify-between gap-4 mb-3">
        <h2 class="text-lg font-semibold text-gray-900 flex-1">{paper.title}</h2>
        <div class="flex gap-2 shrink-0">
          {hasDetailedMetadata && (
            <span class="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-700 capitalize">
              {paper.source.replace('-', ' ')}
            </span>
          )}
          {storedPaper && (
            <span class="px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-700 flex items-center gap-1">
              <Database size={12} />
              Stored
            </span>
          )}
        </div>
      </div>

      {/* Authors */}
      <p class="text-sm text-gray-600 mb-4">{paper.authors.join(', ')}</p>

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
      <div class="flex gap-3">
        <a
          href={paper.url}
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-700 font-medium"
        >
          <ExternalLink size={14} />
          {hasDetailedMetadata ? 'View Original' : 'View Original Paper'}
        </a>

        {paper.metadata?.pdfUrl && (
          <a
            href={paper.metadata.pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-700 font-medium"
          >
            <Download size={14} />
            Download PDF
          </a>
        )}
      </div>
    </div>
  );
}
