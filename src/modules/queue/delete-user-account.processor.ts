import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Inject } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import Redis from 'ioredis';
import { DeleteUserAccountJobData } from './user-delete.queue';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Url, UrlDocument } from '../url/schemas/url.schema';
import { Campaign, CampaignDocument } from '../campaigns/schemas/campaign.schema';
import { QrCode, QrCodeDocument } from '../qrcodes/schemas/qrcode.schema';
import { REDIS_CLIENT } from '../../common/redis/redis.provider';

@Processor('delete-user-account')
export class DeleteUserAccountProcessor extends WorkerHost {
  private readonly logger = new Logger(DeleteUserAccountProcessor.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Url.name) private readonly urlModel: Model<UrlDocument>,
    @InjectModel(Campaign.name) private readonly campaignModel: Model<CampaignDocument>,
    @InjectModel(QrCode.name) private readonly qrCodeModel: Model<QrCodeDocument>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    super();
  }

  async process(job: Job<DeleteUserAccountJobData, any, string>): Promise<any> {
    const { userId, jobId } = job.data;
    this.logger.log(`Processing delete-user-account job: ${jobId} for user: ${userId}`);

    try {
      const userObjectId = new Types.ObjectId(userId);

      // 1. Fetch user URLs to invalidate their Redis cache entries
      const urls = await this.urlModel.find({ userId: userObjectId }).exec();
      const deleteCachePromises = urls.map((u) => this.redis.del(`url:${u.shortCode}`));
      deleteCachePromises.push(this.redis.del(`campaigns:${userId}`));

      await Promise.all(deleteCachePromises);

      // 2. Cascade delete all documents associated with the user across MongoDB collections
      await Promise.all([
        this.urlModel.deleteMany({ userId: userObjectId }).exec(),
        this.campaignModel.deleteMany({ userId: userObjectId }).exec(),
        this.qrCodeModel.deleteMany({ userId: userObjectId }).exec(),
        this.userModel.deleteOne({ _id: userObjectId }).exec(),
      ]);

      const statusResult = { status: 'completed', jobId, message: 'Account successfully deleted' };
      await this.redis.setex(`delete-account:${jobId}`, 600, JSON.stringify(statusResult));

      this.logger.log(`Completed delete-user-account job ${jobId}. All user documents and cache entries removed.`);
      return statusResult;
    } catch (error: any) {
      this.logger.error(`Error processing delete-user-account job ${jobId}: ${error.message}`, error.stack);
      const errorResult = { status: 'failed', error: error.message };
      await this.redis.setex(`delete-account:${jobId}`, 300, JSON.stringify(errorResult));
      throw error;
    }
  }
}
