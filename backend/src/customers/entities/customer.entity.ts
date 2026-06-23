import type { CustomerAddress } from './customer-address.entity';

export interface Customer {
  customerId: number;
  accountNumber: string | null;
  centreNumber: string | null;
  companyName: string | null;
  invBuildingName: string | null;
  invAddressLn1: string | null;
  invAddressLn2: string | null;
  invTownOrCity: string | null;
  invCounty: string | null;
  invPostCode: string | null;
  contactName: string | null;
  contactEmail: string | null;
  reportEmail: string | null;
  contactPhone: string | null;
  contactMobile: string | null;
  contactFax: string | null;
  band: string | null;
  createdOn: Date | null;
  suspended: boolean;
  suspendedOn: Date | null;
  addresses?: CustomerAddress[];
}
