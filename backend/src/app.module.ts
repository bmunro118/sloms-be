import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import databaseConfig from './config/database.config';
import twofaConfig from './config/twofa.config';
import { CustomersModule } from './customers/customers.module';
import { OrderBreakdownModule } from './order-breakdown/order-breakdown.module';
import { OrdersModule } from './orders/orders.module';
import { PriceListModule } from './price-list/price-list.module';
import { SettingsModule } from './settings/settings.module';
import { VatRatesModule } from './vat-rates/vat-rates.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, twofaConfig],
    }),
    PrismaModule,

    CustomersModule,
    OrderBreakdownModule,
    OrdersModule,
    PriceListModule,
    SettingsModule,
    VatRatesModule,
    UsersModule,
    AuthModule,
  ],
})
export class AppModule {}
