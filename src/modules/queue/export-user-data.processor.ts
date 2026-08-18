import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Inject } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import Redis from 'ioredis';
import { ExportUserDataJobData } from './user-export.queue';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Url, UrlDocument } from '../url/schemas/url.schema';
import { Campaign, CampaignDocument } from '../campaigns/schemas/campaign.schema';
import { Click, ClickDocument } from '../analytics/schemas/click.schema';
import { REDIS_CLIENT } from '../../common/redis/redis.provider';

@Processor('export-user-data')
export class ExportUserDataProcessor extends WorkerHost {
  private readonly logger = new Logger(ExportUserDataProcessor.name);
  private readonly EXPORT_CACHE_TTL = 900; // 15 minutes TTL in seconds for completed JSON export result

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Url.name) private readonly urlModel: Model<UrlDocument>,
    @InjectModel(Campaign.name) private readonly campaignModel: Model<CampaignDocument>,
    @InjectModel(Click.name) private readonly clickModel: Model<ClickDocument>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    super();
  }

  async process(job: Job<ExportUserDataJobData, any, string>): Promise<any> {
    const { userId, jobId } = job.data;
    this.logger.log(`Processing export-user-data job: ${jobId} for user: ${userId}`);

    try {
      const userObjectId = new Types.ObjectId(userId);

      const [user, urls, campaigns] = await Promise.all([
        this.userModel.findById(userObjectId).exec(),
        this.urlModel.find({ userId: userObjectId }).exec(),
        this.campaignModel.find({ userId: userObjectId }).exec(),
      ]);

      const shortCodes = urls.map((u) => u.shortCode);
      const clicks = await this.clickModel
        .find({ shortCode: { $in: shortCodes } })
        .sort({ timestamp: -1 })
        .limit(1000)
        .exec();

      const exportResult = {
        status: 'completed',
        jobId,
        exportedAt: new Date().toISOString(),
        user: user ? user.toJSON() : null,
        urls: urls.map((u) => u.toJSON()),
        campaigns: campaigns.map((c) => c.toJSON()),
        clicksHistory: clicks.map((cl) => cl.toJSON()),
      };

      // Store in Redis with 15 minutes TTL keyed on the jobId
      await this.redis.setex(`export:${jobId}`, this.EXPORT_CACHE_TTL, JSON.stringify(exportResult));
      this.logger.log(`Completed export-user-data job ${jobId}. Result saved in Redis.`);
      return exportResult;
    } catch (error: any) {
      this.logger.error(`Error processing export-user-data job ${jobId}: ${error.message}`, error.stack);
      const errorResult = { status: 'failed', error: error.message };
      await this.redis.setex(`export:${jobId}`, 300, JSON.stringify(errorResult));
      throw error;
    }
  }
}
