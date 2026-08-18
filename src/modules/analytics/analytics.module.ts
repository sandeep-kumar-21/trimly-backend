import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Click, ClickSchema } from './schemas/click.schema';
import { UrlModule } from '../url/url.module';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Click.name, schema: ClickSchema }]),
    UrlModule,
  ],
  providers: [AnalyticsService],
  controllers: [AnalyticsController],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
