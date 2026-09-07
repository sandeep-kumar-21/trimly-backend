import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export interface UrlMetadataJobData {
  shortCode?: string;
  shortCodes?: string[];
  longUrl: string;
}

@Injectable()
export class UrlMetadataQueue {
  private readonly logger = new Logger(UrlMetadataQueue.name);

  constructor(
    @InjectQueue('url-metadata') private readonly urlMetadataQueue: Queue<UrlMetadataJobData>,
  ) {}

  /**
   * Enqueues an asynchronous title scraping job for a newly created URL without a custom title.
   */
  async addScrapeTitleJob(data: UrlMetadataJobData): Promise<void> {
    try {
      await this.urlMetadataQueue.add('scrape-title', data, {
        attempts: 2,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: true,
        removeOnFail: 50,
      });
      this.logger.debug(`Enqueued scrape-title job for shortCode: ${data.shortCode || data.shortCodes?.join(', ')}`);
    } catch (error: any) {
      this.logger.error(`Failed to enqueue scrape-title job`, error);
    }
  }

  /**
   * Enqueues a single batch title scraping job for multiple short URLs sharing the same destination URL.
   */
  async addScrapeTitleBatchJob(data: { shortCodes: string[]; longUrl: string }): Promise<void> {
    try {
      await this.urlMetadataQueue.add('scrape-title', data, {
        attempts: 2,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: true,
        removeOnFail: 50,
      });
      this.logger.debug(`Enqueued batch scrape-title job for ${data.shortCodes.length} codes: [${data.shortCodes.join(', ')}]`);
    } catch (error: any) {
      this.logger.error(`Failed to enqueue batch scrape-title job`, error);
    }
  }
}
