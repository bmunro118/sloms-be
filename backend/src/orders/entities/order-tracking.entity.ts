import { OrderStatus } from '../enums/order-status.enum';
import { ItemStatus } from '../enums/item-status.enum';

export interface TrackingItem {
  serialNumber: string;
  description: string | null;
  side: string | null;
  status: ItemStatus;
}

export interface TrackingHistoryEntry {
  status: OrderStatus;
  changedOn: Date;
}

export interface OrderTracking {
  orderNumber: number;
  orderBatch: number;
  customerRef: string | null;
  status: OrderStatus;
  statusChangedOn: Date | null;
  history: TrackingHistoryEntry[];
  items: TrackingItem[];
}
