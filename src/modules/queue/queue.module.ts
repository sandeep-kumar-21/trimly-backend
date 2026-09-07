import { Module, DynamicModule, Logger } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ClickQueue } from './click.queue';
import { ClickProcessor } from './click.processor';
import { UserExportQueue } from './user-export.queue';
import { UserDeleteQueue } from './user-delete.queue';
import { ExportUserDataProcessor } from './export-user-data.processor';
import { DeleteUserAccountProcessor } from './delete-user-account.processor';
import { UrlMetadataQueue } from './url-metadata.queue';
import { UrlMetadataProcessor } from './url-metadata.processor';
import { Click, ClickSchema } from '../analytics/schemas/click.schema';
import { Url, UrlSchema } from '../url/schemas/url.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Campaign, CampaignSchema } from '../campaigns/schemas/campaign.schema';
import { QrCode, QrCodeSchema } from '../qrcodes/schemas/qrcode.schema';
import { getRedisConfig } from '../../config/redis.config';

@Module({})
export class QueueModule {
  private static readonly logger = new Logger('QueueModule');

  static register(): DynamicModule {
    const isWorkerEnabled =
      process.env.WORKER_ENABLED === 'true' || process.env.WORKER_ENABLED === undefined;

    this.logger.log(
      `Initializing QueueModule. BullMQ Worker In-Process: ${isWorkerEnabled ? 'ENABLED' : 'DISABLED'}`,
    );

    const providers: any[] = [ClickQueue, UserExportQueue, UserDeleteQueue, UrlMetadataQueue];
    if (isWorkerEnabled) {
      providers.push(
        ClickProcessor,
        ExportUserDataProcessor,
        DeleteUserAccountProcessor,
        UrlMetadataProcessor,
      );
    }

    return {
      global: true,
      module: QueueModule,
      imports: [
        ConfigModule,
        MongooseModule.forFeature([
          { name: Click.name, schema: ClickSchema },
          { name: Url.name, schema: UrlSchema },
          { name: User.name, schema: UserSchema },
          { name: Campaign.name, schema: CampaignSchema },
          { name: QrCode.name, schema: QrCodeSchema },
        ]),
        BullModule.forRootAsync({
          imports: [ConfigModule],
          useFactory: (configService: ConfigService) => ({
            connection: getRedisConfig(configService),
          }),
          inject: [ConfigService],
        }),
        BullModule.registerQueue(
          { name: 'clicks' },
          { name: 'export-user-data' },
          { name: 'delete-user-account' },
          { name: 'url-metadata' },
        ),
      ],
      providers,
      exports: [ClickQueue, UserExportQueue, UserDeleteQueue, UrlMetadataQueue, BullModule],
    };
  }
}
