import { useEffect, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginatedRowsProps<T> {
  items: readonly T[];
  renderRow: (item: T) => ReactNode;
  itemLabel: string;
  resetKey?: string;
  className?: string;
}

/**
 * A bounded list surface: the DOM only contains the current page, even for
 * large histories. Filter changes reset navigation; shrinking data clamps it.
 */
export function PaginatedRows<T>({
  items, renderRow, itemLabel, resetKey, className = 'divide-y divide-slate-100',
}: PaginatedRowsProps<T>) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => { setPage(1); }, [resetKey]);

  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(page, pages);
  const start = (currentPage - 1) * pageSize;
  const end = Math.min(items.length, start + pageSize);

  return <>
    <div className={className}>{items.slice(start, end).map(renderRow)}</div>
    {items.length > 10 && <nav className="vg-list-pager" aria-label={itemLabel + ' pagination'}>
      <span className="vg-list-pager-summary" role="status">
        Showing {start + 1}–{end} of {items.length} {itemLabel}
      </span>
      <div className="vg-list-pager-actions">
        <label className="vg-list-size-label">
          <span>Rows</span>
          <select aria-label={'Rows per page for ' + itemLabel} value={pageSize}
            onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }}>
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
          </select>
        </label>
        <span className="vg-list-page-count" aria-live="polite">{currentPage} / {pages}</span>
        <button type="button" aria-label={'Previous ' + itemLabel + ' page'}
          title="Previous page" disabled={currentPage === 1}
          onClick={() => setPage(value => Math.max(1, value - 1))}>
          <ChevronLeft size={16} aria-hidden="true"/>
        </button>
        <button type="button" aria-label={'Next ' + itemLabel + ' page'}
          title="Next page" disabled={currentPage >= pages}
          onClick={() => setPage(value => Math.min(pages, value + 1))}>
          <ChevronRight size={16} aria-hidden="true"/>
        </button>
      </div>
    </nav>}
  </>;
}
