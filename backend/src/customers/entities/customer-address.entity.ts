import type { Customer } from "./customer.entity";

export interface CustomerAddress {
  addressId: number;
  customerAccount: number | null;
  siteCompanyName: string | null;
  delBuildingName: string | null;
  delAddressLn1: string | null;
  delAddressLn2: string | null;
  delTownOrCity: string | null;
  delCounty: string | null;
  delPostCode: string | null;
  siteContactName: string | null;
  siteContactEmail: string | null;
  siteContactPhone: string | null;
  siteContactMobile: string | null;
  siteContactFax: string | null;
  defaultAddress: boolean;
  void: boolean;
  createdOn: Date | null;
  customer?: Customer | null;
}
