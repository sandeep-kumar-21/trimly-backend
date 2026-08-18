import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { QrCode, QrCodeSchema } from './schemas/qrcode.schema';
import { Url, UrlSchema } from '../url/schemas/url.schema';
import { UrlModule } from '../url/url.module';
import { QrCodesService } from './qrcodes.service';
import { QrCodesController } from './qrcodes.controller';

@Module({
  imports: [
    ConfigModule,
    UrlModule,
    MongooseModule.forFeature([
      { name: QrCode.name, schema: QrCodeSchema },
      { name: Url.name, schema: UrlSchema },
    ]),
  ],
  providers: [QrCodesService],
  controllers: [QrCodesController],
  exports: [QrCodesService],
})
export class QrCodesModule {}
