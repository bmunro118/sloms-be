import { Module } from '@nestjs/common';
import { VatRatesController } from './vat-rates.controller';
import { VatRatesService } from './vat-rates.service';

@Module({
  controllers: [VatRatesController],
  providers: [VatRatesService],
  exports: [VatRatesService],
})
export class VatRatesModule {}
