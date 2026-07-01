import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrderBreakdownModule } from '../order-breakdown/order-breakdown.module';
import { PriceListModule } from '../price-list/price-list.module';

@Module({
  imports: [OrderBreakdownModule, PriceListModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
