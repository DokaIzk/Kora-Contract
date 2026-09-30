import React, { useState, useMemo, useRef } from 'react';
import { ColumnDef, DataTableProps, SortState } from '../../types/table';

export function DataTable<T extends Record<string, any>>({
  data,
  columns,
  rowKey,
  pageSize = 10,
  virtualized = true,
  rowHeight = 48,
  maxContainerHeight = 400,
  onRowClick,
  ariaLabel = 'Invoice data table',
  caption = 'Invoice Listings and Positions Data Table',
}: DataTableProps<T>): React.ReactElement {
  // Sort state
  const [sortState, setSortState] = useState<SortState>({
    columnId: null,
    direction: null,
  });

  // Filter state
  const [globalFilter, setGlobalFilter] = useState<string>('');
  const [focusedRowIndex, setFocusedRowIndex] = useState<number>(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState<number>(0);

  // Column header sort click handler
  const handleHeaderSort = (columnId: string, sortable?: boolean) => {
    if (!sortable) return;

    setSortState((prev) => {
      if (prev.columnId !== columnId) {
        return { columnId, direction: 'asc' };
      }
      if (prev.direction === 'asc') {
        return { columnId, direction: 'desc' };
      }
      return { columnId: null, direction: null };
    });
  };

  // Filtered and Sorted data pipeline
  const filteredData = useMemo(() => {
    if (!globalFilter.trim()) return data;
    const query = globalFilter.toLowerCase();
    return data.filter((row) =>
      columns.some((col) => {
        const val = col.accessor(row);
        return val !== null && val !== undefined && String(val).toLowerCase().includes(query);
      })
    );
  }, [data, columns, globalFilter]);

  const sortedData = useMemo(() => {
    if (!sortState.columnId || !sortState.direction) return filteredData;
    const col = columns.find((c) => c.id === sortState.columnId);
    if (!col) return filteredData;

    return [...filteredData].sort((a, b) => {
      const valA = col.accessor(a);
      const valB = col.accessor(b);

      if (valA === valB) return 0;
      if (valA === null || valA === undefined) return 1;
      if (valB === null || valB === undefined) return -1;

      const comparison = valA < valB ? -1 : 1;
      return sortState.direction === 'asc' ? comparison : -comparison;
    });
  }, [filteredData, columns, sortState]);

  // Virtualization window calculations
  const totalRows = sortedData.length;
  const totalHeight = totalRows * rowHeight;

  const startIndex = virtualized
    ? Math.max(0, Math.floor(scrollTop / rowHeight) - 2)
    : 0;
  const visibleCount = virtualized
    ? Math.ceil(maxContainerHeight / rowHeight) + 4
    : totalRows;
  const endIndex = virtualized
    ? Math.min(totalRows, startIndex + visibleCount)
    : totalRows;

  const visibleRows = sortedData.slice(startIndex, endIndex);

  // Handle scroll for virtualized viewport
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  // Keyboard navigation across rows
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTableElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedRowIndex((prev) => Math.min(sortedData.length - 1, prev + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedRowIndex((prev) => Math.max(0, prev - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setFocusedRowIndex(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setFocusedRowIndex(sortedData.length - 1);
    } else if (e.key === 'Enter' && focusedRowIndex >= 0 && onRowClick) {
      e.preventDefault();
      onRowClick(sortedData[focusedRowIndex]);
    }
  };

  return (
    <div className="data-table-container bg-white border border-gray-200 rounded-2xl p-4 space-y-3 shadow-sm">
      {/* Table Global Filter & Search Control */}
      <div className="flex justify-between items-center flex-wrap gap-2">
        <label className="sr-only" htmlFor="data-table-search">
          Filter table rows
        </label>
        <input
          id="data-table-search"
          type="text"
          placeholder="Filter data table rows..."
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none w-full sm:w-64"
        />
        <span className="text-xs text-gray-500 font-medium">
          Showing {sortedData.length} of {data.length} records
        </span>
      </div>

      {/* Virtualized Scroll Container */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        style={{ maxHeight: virtualized ? `${maxContainerHeight}px` : 'auto', overflowY: virtualized ? 'auto' : 'visible' }}
        className="border border-gray-200 rounded-xl overflow-x-auto relative"
      >
        <table
          className="w-full text-left text-xs"
          role="grid"
          aria-label={ariaLabel}
          aria-rowcount={sortedData.length}
          aria-colcount={columns.length}
          onKeyDown={handleKeyDown}
          tabIndex={0}
        >
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-gray-50 text-gray-700 font-semibold border-b border-gray-200 sticky top-0 z-10">
            <tr role="row">
              {columns.map((col) => {
                const isSorted = sortState.columnId === col.id;
                const ariaSortVal = isSorted
                  ? sortState.direction === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : 'none';

                return (
                  <th
                    key={String(col.id)}
                    role="columnheader"
                    aria-sort={col.sortable ? ariaSortVal : undefined}
                    onClick={() => handleHeaderSort(String(col.id), col.sortable)}
                    onKeyDown={(e) => {
                      if ((e.key === 'Enter' || e.key === ' ') && col.sortable) {
                        e.preventDefault();
                        handleHeaderSort(String(col.id), col.sortable);
                      }
                    }}
                    tabIndex={col.sortable ? 0 : -1}
                    style={{ width: col.width, textAlign: col.align || 'left' }}
                    className={`p-3 select-none ${col.sortable ? 'cursor-pointer hover:bg-gray-100' : ''}`}
                  >
                    <div className="flex items-center gap-1">
                      <span>{col.header}</span>
                      {col.sortable && (
                        <span className="text-gray-400 font-bold">
                          {isSorted ? (sortState.direction === 'asc' ? '▲' : '▼') : '↕'}
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody
            className="divide-y divide-gray-100"
            style={{
              height: virtualized ? `${totalHeight}px` : 'auto',
              position: 'relative',
            }}
          >
            {virtualized && startIndex > 0 && (
              <tr style={{ height: `${startIndex * rowHeight}px` }} aria-hidden="true" />
            )}

            {visibleRows.map((row, index) => {
              const actualIndex = startIndex + index;
              const isFocused = focusedRowIndex === actualIndex;
              const key = rowKey(row);

              return (
                <tr
                  key={key}
                  role="row"
                  aria-rowindex={actualIndex + 1}
                  aria-selected={isFocused}
                  onClick={() => onRowClick && onRowClick(row)}
                  style={{ height: `${rowHeight}px` }}
                  className={`hover:bg-gray-50 transition-colors ${
                    isFocused ? 'bg-indigo-50 border-l-4 border-indigo-600 font-semibold' : ''
                  } ${onRowClick ? 'cursor-pointer' : ''}`}
                >
                  {columns.map((col) => {
                    const rawVal = col.accessor(row);
                    const cellContent = col.cell ? col.cell(rawVal, row) : String(rawVal ?? '');

                    return (
                      <td
                        key={String(col.id)}
                        role="gridcell"
                        style={{ textAlign: col.align || 'left' }}
                        className="p-3 text-gray-800"
                      >
                        {cellContent}
                      </td>
                    );
                  })}
                </tr>
              );
            })}

            {virtualized && endIndex < totalRows && (
              <tr style={{ height: `${(totalRows - endIndex) * rowHeight}px` }} aria-hidden="true" />
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
