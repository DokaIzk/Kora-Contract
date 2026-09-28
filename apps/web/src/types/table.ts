export type SortDirection = 'asc' | 'desc' | null;

export interface ColumnDef<T> {
  id: keyof T | string;
  header: string;
  accessor: (row: T) => any;
  sortable?: boolean;
  filterable?: boolean;
  width?: string;
  align?: 'left' | 'center' | 'right';
  cell?: (value: any, row: T) => React.ReactNode;
}

export interface SortState {
  columnId: string | null;
  direction: SortDirection;
}

export interface FilterState {
  globalFilter: string;
  columnFilters: Record<string, string>;
}

export interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  rowKey: (row: T) => string;
  pageSize?: number;
  virtualized?: boolean;
  rowHeight?: number;
  maxContainerHeight?: number;
  onRowClick?: (row: T) => void;
  ariaLabel?: string;
  caption?: string;
}
