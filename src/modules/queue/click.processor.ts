import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Inject } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UAParser } from 'ua-parser-js';
import * as geoip from 'geoip-lite';
import Redis from 'ioredis';
import { ClickJobData } from './click.queue';
import { Click, ClickDocument } from '../analytics/schemas/click.schema';
import { Url, UrlDocument } from '../url/schemas/url.schema';
import { REDIS_CLIENT } from '../../common/redis/redis.provider';

@Processor('clicks')
export class ClickProcessor extends WorkerHost {
  private readonly logger = new Logger(ClickProcessor.name);

  constructor(
    @InjectModel(Click.name) private readonly clickModel: Model<ClickDocument>,
    @InjectModel(Url.name) private readonly urlModel: Model<UrlDocument>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    super();
  }

  async process(job: Job<ClickJobData, any, string>): Promise<any> {
    const { shortCode, timestamp, referrer, userAgent, ipHash, rawIp, country: jobCountry, isQrScan } = job.data;
    this.logger.debug(`Processing click event for shortCode: ${shortCode}`);

    // Parse User-Agent using ua-parser-js
    let deviceType = 'Desktop';
    let browser = 'Unknown';
    let os: string | null = null;

    if (userAgent) {
      const parser = new UAParser(userAgent);
      const result = parser.getResult();
      const type = result.device.type;
      if (type === 'mobile') {
        deviceType = 'Mobile';
      } else if (type === 'tablet') {
        deviceType = 'Tablet';
      } else if (type) {
        deviceType = type.charAt(0).toUpperCase() + type.slice(1);
      } else {
        deviceType = 'Desktop';
      }

      if (result.browser && result.browser.name) {
        browser = result.browser.name;
      }
      if (result.os && result.os.name) {
        os = result.os.name;
      }
    }

    // Resolve IP to country, city, region using geoip-lite
    let country = jobCountry || null;
    let city: string | null = null;
    let region: string | null = null;

    if (rawIp) {
      const geo = geoip.lookup(rawIp);
      if (geo) {
        if (!country && geo.country) country = geo.country;
        if (geo.city) city = geo.city;
        if (geo.region) region = geo.region;
      }
    }

    try {
      // 1. Increment total clickCount on URL document and fetch updated document
      const updatedUrl = await this.urlModel.findOneAndUpdate(
        { shortCode },
        { $inc: { clickCount: 1 } },
        { returnDocument: 'after' },
      );

      // 2. Record enriched click analytics document
      await this.clickModel.create({
        shortCode,
        userId: updatedUrl?.userId || null,
        campaignId: updatedUrl?.campaignId || null,
        timestamp: new Date(timestamp),
        referrer,
        userAgent,
        ipHash,
        deviceType,
        browser,
        os,
        country,
        city,
        region,
        isQrScan: Boolean(isQrScan),
        utmSource: job.data.utmSource || updatedUrl?.utmSource || null,
        utmMedium: job.data.utmMedium || updatedUrl?.utmMedium || null,
        utmCampaign: job.data.utmCampaign || updatedUrl?.utmCampaign || null,
        utmTerm: job.data.utmTerm || updatedUrl?.utmTerm || null,
        utmContent: job.data.utmContent || updatedUrl?.utmContent || null,
      });

      // 3. Publish real-time click telemetry to Redis Pub/Sub for live streaming
      if (updatedUrl && updatedUrl.userId) {
        try {
          const livePayload = JSON.stringify({
            shortCode,
            timestamp: new Date(timestamp).toISOString(),
            country,
            city,
            region,
            deviceType,
            browser,
            os,
            referrer,
            isQrScan: Boolean(isQrScan),
            utmSource: job.data.utmSource || updatedUrl.utmSource || null,
            utmMedium: job.data.utmMedium || updatedUrl.utmMedium || null,
            utmCampaign: job.data.utmCampaign || updatedUrl.utmCampaign || null,
            userId: updatedUrl.userId.toString(),
          });

          await this.redis.publish(`analytics:live:${updatedUrl.userId.toString()}`, livePayload);
        } catch (publishErr: any) {
          this.logger.warn(`Failed to publish live click event to Redis for ${shortCode}: ${publishErr.message}`);
        }
      }

      // 4. Invalidate Redis cache keys so dashboards reflect real-time clicks instantly
      if (updatedUrl) {
        try {
          const pipeline = this.redis.pipeline();
          if (updatedUrl.campaignId) {
            pipeline.del(`campaign:${updatedUrl.campaignId.toString()}`);
          }
          if (updatedUrl.userId) {
            pipeline.del(`campaigns:${updatedUrl.userId.toString()}`);
            // Also invalidate analytics query caches for user
            const analyticsKeys = await this.redis.keys(`analytics:${updatedUrl.userId.toString()}:*`);
            if (analyticsKeys.length > 0) {
              pipeline.del(...analyticsKeys);
            }
          }
          await pipeline.exec();
        } catch (err: any) {
          this.logger.warn(`Failed to invalidate cache after click for ${shortCode}: ${err.message}`);
        }
      }

      this.logger.debug(`Click logged & clickCount incremented for code: ${shortCode}`);
    } catch (error) {
      this.logger.error(`Error processing click job for code: ${shortCode}`, error);
      throw error;
    }
  }
}

