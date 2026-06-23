import type { Customer } from "../../customers/entities/customer.entity";
import type { CustomerAddress } from "../../customers/entities/customer-address.entity";
import type { OrderedItem } from "./ordered-item.entity";
import type { VatRate } from "../../vat-rates/entities/vat-rate.entity";
import { OrderStatus } from "../enums/order-status.enum";

export interface OrderStatusHistoryEntry {
  id: number;
  status: OrderStatus;
  changedOn: Date;
}

export interface Order {
  orderNumber: number;
  orderBatch: number;
  customerAccount: number | null;
  customerRef: string | null;
  orderContact: string | null;
  deliveryAddress: number | null;
  receivedOn: Date | null;
  dispatchedOn: Date | null;
  vatRateId: number | null;
  priceBand: string | null;
  createdOn: Date | null;
  dispatchDateStamp: Date | null;
  void: boolean;
  voidDateStamp: Date | null;
  voidedBy: string | null;
  createdBy: string | null;
  status: OrderStatus;
  statusChangedOn: Date | null;
  // Computed at runtime from items
  itemCount: number;
  orderTotal: number;
  avgPrice: number;
  customer?: Customer | null;
  deliveryAddressDetail?: CustomerAddress | null;
  vatRate?: VatRate | null;
  items?: OrderedItem[];
  statusHistory?: OrderStatusHistoryEntry[];
}
