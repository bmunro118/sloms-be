export type RevisionStatus = 'draft' | 'active' | 'archived';

export interface PriceListItem {
  itemId: string;
  category: string | null;
  description: string | null;
  void: boolean;
  voidDateStamp: Date | null;
  voidedBy: string | null;
  createdAt: Date;
  createdBy: string | null;
}

export interface PriceListType {
  id: number;
  name: string;
  displayName: string | null;
  sortOrder: number;
  isActive: boolean;
  void: boolean;
  voidDateStamp: Date | null;
  voidedBy: string | null;
  createdAt: Date;
  createdBy: string | null;
}

export interface PriceListRevision {
  id: number;
  name: string;
  status: RevisionStatus;
  importedAt: Date;
  activatedAt: Date | null;
  notes: string | null;
  importedBy: string | null;
}

export interface ItemPrice {
  itemId: string;
  listId: number;
  revisionId: number;
  price: number | null;
}

/** Wide/pivoted view of a price list item — used for JSON responses and CSV */
export interface PriceListRow {
  itemId: string;
  category: string | null;
  description: string | null;
  prices: Record<string, number | null>;
}

export interface CsvImportResult {
  revision: PriceListRevision | null;
  /** Number of rows processed from the CSV */
  csvItemCount: number;
  /** CSV items whose ItemID did not exist in the active revision (new additions) */
  itemsAdded: number;
  /** CSV items whose ItemID already existed in the active revision (updates) */
  itemsUpdated: number;
  /** Items carried forward unchanged from the active revision (merge mode only, else null) */
  itemsCarriedForward: number | null;
  /** Total items in the new revision (merge mode only, else null) */
  mergedItemCount: number | null;
  /** Lists carried forward from the active revision not present in the CSV (merge mode only, else null) */
  listsCarriedForward: string[] | null;
  /** List names that have never existed in the registry before */
  listsNewToRegistry: string[];
  /** List names that exist in the registry but were absent from the active revision */
  listsNewToActiveRevision: string[];
  warnings: string[];
}
