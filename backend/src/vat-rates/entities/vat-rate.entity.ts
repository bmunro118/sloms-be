export interface VatRate {
  vatRateId: number;
  rate: number;
  label: string;
  validFrom: Date;
  validTo: Date | null;
}
