import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UAParser } from 'ua-parser-js';
import * as geoip from 'geoip-lite';
import { ClickJobData } from './click.queue';
import { Click, ClickDocument } from '../analytics/schemas/click.schema';
import { Url, UrlDocument } from '../url/schemas/url.schema';

@Processor('clicks')
export class ClickProcessor extends WorkerHost {
  private readonly logger = new Logger(ClickProcessor.name);

  constructor(
    @InjectModel(Click.name) private readonly clickModel: Model<ClickDocument>,
    @InjectModel(Url.name) private readonly urlModel: Model<UrlDocument>,
  ) {
    super();
  }

  async process(job: Job<ClickJobData, any, string>): Promise<any> {
    const { shortCode, timestamp, referrer, userAgent, ipHash, rawIp, country: jobCountry } = job.data;
    this.logger.debug(`Processing click event for shortCode: ${shortCode}`);

    // Parse User-Agent using ua-parser-js
    let deviceType = 'Desktop';
    let browser = 'Unknown';

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
    }

    // Resolve IP to country using geoip-lite
    let country = jobCountry || null;
    if (!country && rawIp) {
      const geo = geoip.lookup(rawIp);
      if (geo && geo.country) {
        country = geo.country;
      }
    }

    try {
      // 1. Record click analytics document
      await this.clickModel.create({
        shortCode,
        timestamp: new Date(timestamp),
        referrer,
        userAgent,
        ipHash,
        deviceType,
        browser,
        country,
      });

      // 2. Increment total clickCount on URL document
      await this.urlModel.updateOne(
        { shortCode },
        { $inc: { clickCount: 1 } },
      );

      this.logger.debug(`Click logged & clickCount incremented for code: ${shortCode}`);
    } catch (error) {
      this.logger.error(`Error processing click job for code: ${shortCode}`, error);
      throw error;
    }
  }
}
