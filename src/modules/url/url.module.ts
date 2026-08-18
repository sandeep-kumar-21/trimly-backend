import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Url, UrlSchema } from './schemas/url.schema';
import { QrCode, QrCodeSchema } from '../qrcodes/schemas/qrcode.schema';
import { Counter, CounterSchema } from '../../database/counter.schema';
import { UrlService } from './url.service';
import { UrlController } from './url.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Url.name, schema: UrlSchema },
      { name: QrCode.name, schema: QrCodeSchema },
      { name: Counter.name, schema: CounterSchema },
    ]),
  ],
  providers: [UrlService],
  controllers: [UrlController],
  exports: [UrlService, MongooseModule],
})
export class UrlModule {}
