import { Module } from "@nestjs/common";
import { OrderBreakdownService } from "./order-breakdown.service";

@Module({
  providers: [OrderBreakdownService],
  exports: [OrderBreakdownService],
})
export class OrderBreakdownModule {}
