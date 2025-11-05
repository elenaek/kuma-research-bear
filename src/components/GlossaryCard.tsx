import { useState, useEffect } from 'preact/hooks';
import { ChevronDown, ChevronUp, BookOpen, Search, X, ChevronLeft, ChevronRight } from 'lucide-preact';
import { Tooltip } from './Tooltip.tsx';
import { GlossaryTerm } from '../shared/types/index.ts';

interface GlossaryCardProps {
  term: GlossaryTerm;
}

export function GlossaryCard({ term }: GlossaryCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div class="border border-gray-200 rounded-md hover:shadow-sm transition-shadow hover:cursor-pointer" style={{ overflow: 'visible' }}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        class="w-full text-left focus:outline-none rounded hover:cursor-pointer p-3"
        style={{ overflow: 'visible' }}
        title={`${term.acronym} - ${term.longForm}: ${term.definition}`}
        aria-expanded={isExpanded}
        aria-controls={`glossary-content-${term.acronym}`}
      >
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5 flex-grow truncate">
            <span class="text-base font-bold text-blue-600">{term.acronym}</span>
            <span class="text-gray-400 text-sm">—</span>
            <span class="text-sm text-gray-700 truncate">{term.longForm}</span>
            <Tooltip text={term.analogy} />
          </div>
          <div class="flex-shrink-0 ml-2">
            {isExpanded ? (
              <ChevronUp size={16} class="text-gray-500" />
            ) : (
              <ChevronDown size={16} class="text-gray-500" />
            )}
          </div>
        </div>
      </button>

      {isExpanded && (
        <div
          id={`glossary-content-${term.acronym}`}
          class="p-4 border-t border-gray-100 space-y-2 animate-fadeIn cursor-default hover:cursor-default"
        >
          <div>
            <h4 class="text-xs font-semibold text-gray-700 mb-1">Definition</h4>
            <p class="text-xs text-gray-600">{term.definition}</p>
          </div>

          <div class="mb-4">
            <h4 class="text-xs font-semibold text-gray-700 mb-2">Study Context</h4>
            {term.studyContext.length === 1 && term.studyContext[0].sections.length === 1 ? (
              <div class="text-xs text-gray-600">
                <p>{term.studyContext[0].context}</p>
                <p class="text-xs text-gray-500 mt-1 italic">
                  Section: {term.studyContext[0].sections[0]}
                </p>
              </div>
            ) : (
              <div class="space-y-2">
                {term.studyContext.map((ctx, idx) => (
                  <div key={idx} class="text-xs">
                    <div class="flex items-start">
                      <span class="text-gray-500 mr-1">{idx + 1}.</span>
                      <div class="flex-1">
                        <span class="text-gray-600">{ctx.context}</span>
                        <div class="text-gray-500 text-xs mt-0.5 italic">
                          {ctx.sections.length === 1 ? (
                            <span>Section: {ctx.sections[0]}</span>
                          ) : (
                            <span>Sections: {ctx.sections.join(', ')}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div class="flex items-start gap-2 bg-blue-50 p-2 rounded">
            <BookOpen size={14} class="text-blue-600 mt-0.5 flex-shrink-0" />
            <div>
              <h4 class="text-xs font-semibold text-blue-700 mb-0.5">Analogy</h4>
              <p class="text-xs text-blue-600">{term.analogy}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface GlossaryListProps {
  terms: GlossaryTerm[];
}

export function GlossaryList({ terms }: GlossaryListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [itemsPerPage, setItemsPerPage] = useState<number | 'all'>(10);
  const [currentPage, setCurrentPage] = useState(1);

  if (!terms || terms.length === 0) {
    return (
      <div class="text-center py-8">
        <BookOpen size={48} class="text-gray-300 mx-auto mb-4" />
        <p class="text-gray-500">No glossary terms found in this paper</p>
      </div>
    );
  }

  // Filter terms based on search query
  const filteredTerms = searchQuery
    ? terms.filter(term =>
        term.acronym.toLowerCase().includes(searchQuery.toLowerCase()) ||
        term.longForm.toLowerCase().includes(searchQuery.toLowerCase()) ||
        term.definition.toLowerCase().includes(searchQuery.toLowerCase()) ||
        term.studyContext.some(ctx =>
          ctx.context.toLowerCase().includes(searchQuery.toLowerCase()) ||
          ctx.sections.some(section =>
            section.toLowerCase().includes(searchQuery.toLowerCase())
          )
        )
      )
    : terms;

  // Reset to page 1 when search query changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  // Reset to page 1 when items per page changes
  useEffect(() => {
    setCurrentPage(1);
  }, [itemsPerPage]);

  // Calculate pagination
  const totalPages = itemsPerPage === 'all' ? 1 : Math.ceil(filteredTerms.length / itemsPerPage);

  // Ensure current page is valid
  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  // Get paginated terms
  const paginatedTerms = itemsPerPage === 'all'
    ? filteredTerms
    : filteredTerms.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  // Generate page numbers for pagination controls
  const getPageNumbers = () => {
    const pages = [];
    const maxPagesToShow = 5;

    if (totalPages <= maxPagesToShow) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      if (currentPage <= 3) {
        for (let i = 1; i <= 4; i++) pages.push(i);
        pages.push('...');
        pages.push(totalPages);
      } else if (currentPage >= totalPages - 2) {
        pages.push(1);
        pages.push('...');
        for (let i = totalPages - 3; i <= totalPages; i++) pages.push(i);
      } else {
        pages.push(1);
        pages.push('...');
        pages.push(currentPage - 1);
        pages.push(currentPage);
        pages.push(currentPage + 1);
        pages.push('...');
        pages.push(totalPages);
      }
    }

    return pages;
  };

  return (
    <div class="space-y-2">
      <div class="flex items-center justify-between gap-2 mb-3">
        <div class="flex items-center gap-2">
          <BookOpen size={18} class="text-blue-600" />
          <h3 class="text-base font-semibold text-gray-900">
            Glossary of Terms ({terms.length})
          </h3>
        </div>

        {/* Items Per Page Dropdown */}
        <div class="flex items-center gap-2">
          <label htmlFor="items-per-page" class="text-sm text-gray-700 font-medium">
            Show:
          </label>
          <select
            id="items-per-page"
            value={itemsPerPage}
            defaultValue={10}
            onChange={(e) => setItemsPerPage((e.target as HTMLSelectElement).value === 'all' ? 'all' : Number((e.target as HTMLSelectElement).value))}
            class="text-sm border border-gray-300 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent hover:cursor-pointer"
          >
            <option value="all">All</option>
            <option value={10}>10 per page</option>
            <option value={15}>15 per page</option>
            <option value={20}>20 per page</option>
          </select>
        </div>
      </div>

      {/* Search Bar */}
      <div class="relative mb-3">
        <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <Search size={16} class="text-gray-400" />
        </div>
        <input
          type="text"
          value={searchQuery}
          onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
          placeholder="Search terms..."
          class="w-full pl-9 pr-9 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            class="absolute inset-y-0 right-0 pr-3 flex items-center"
            aria-label="Clear search"
          >
            <X size={16} class="text-gray-400 hover:text-gray-600" />
          </button>
        )}
      </div>

      {/* Results Count */}
      {searchQuery && (
        <p class="text-xs text-gray-500 mb-2">
          Showing {filteredTerms.length} of {terms.length} terms
        </p>
      )}

      {/* Term Cards */}
      {filteredTerms.length > 0 ? (
        <>
          <div class="space-y-1.5" style={{ overflow: 'visible' }}>
            {paginatedTerms.map((term, index) => (
              <GlossaryCard key={`${term.acronym}-${index}`} term={term} />
            ))}
          </div>

          {/* Pagination Controls */}
          {itemsPerPage !== 'all' && totalPages > 1 && (
            <div class="flex items-center justify-center gap-2 mt-4 pt-4 border-t border-gray-200">
              {/* Previous Button */}
              <button
                onClick={() => setCurrentPage(currentPage - 1)}
                disabled={currentPage === 1}
                class={`flex items-center gap-1 px-3 py-1.5 text-sm rounded-md transition-colors hover:cursor-pointer ${
                  currentPage === 1
                    ? 'text-gray-400 cursor-not-allowed'
                    : 'text-blue-600 hover:bg-blue-50'
                }`}
                aria-label="Previous page"
              >
                <ChevronLeft size={16} />
                Previous
              </button>

              {/* Page Numbers */}
              <div class="flex items-center gap-1">
                {getPageNumbers().map((page, idx) => (
                  typeof page === 'number' ? (
                    <button
                      key={idx}
                      onClick={() => setCurrentPage(page)}
                      class={`px-3 py-1.5 text-sm rounded-md transition-colors hover:cursor-pointer ${
                        currentPage === page
                          ? 'bg-blue-600 text-white'
                          : 'text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      {page}
                    </button>
                  ) : (
                    <span key={idx} class="px-2 text-gray-400">
                      {page}
                    </span>
                  )
                ))}
              </div>

              {/* Next Button */}
              <button
                onClick={() => setCurrentPage(currentPage + 1)}
                disabled={currentPage === totalPages}
                class={`flex items-center gap-1 px-3 py-1.5 text-sm rounded-md transition-colors hover:cursor-pointer ${
                  currentPage === totalPages
                    ? 'text-gray-400 cursor-not-allowed'
                    : 'text-blue-600 hover:bg-blue-50'
                }`}
                aria-label="Next page"
              >
                Next
                <ChevronRight size={16} />
              </button>
            </div>
          )}

          {/* Page Info */}
          {itemsPerPage !== 'all' && totalPages > 1 && (
            <p class="text-xs text-center text-gray-500 mt-2">
              Page {currentPage} of {totalPages}
            </p>
          )}
        </>
      ) : (
        <div class="text-center py-6">
          <p class="text-sm text-gray-500">No terms match "{searchQuery}"</p>
        </div>
      )}
    </div>
  );
}