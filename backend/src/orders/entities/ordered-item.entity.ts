import type { Order } from "./order.entity";
import { ItemStatus } from "../enums/item-status.enum";

export interface OrderedItem {
  serialNumber: string;
  patientInitial: string | null;
  patientSurname: string | null;
  modelCode: string | null;
  createdOn: Date | null;
  week: number | null;
  parentOrder: number | null;
  parentBatch: number | null;
  customerRef: string | null;
  side: string | null;
  description: string | null;
  category: string | null;
  price: number | null;
  vent: number | null;
  colour: string | null;
  tubing: string | null;
  options: string | null;
  checkedOut: boolean;
  checkoutDateStamp: Date | null;
  void: boolean;
  voidDateStamp: Date | null;
  voidedBy: string | null;
  createdBy: string | null;
  status: ItemStatus;
  order?: Order | null;
}
