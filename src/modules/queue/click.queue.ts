import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export interface ClickJobData {
  shortCode: string;
  timestamp: string;
  referrer: string | null;
  userAgent: string | null;
  ipHash: string;
  rawIp?: string | null;
  country: string | null;
}

@Injectable()
export class ClickQueue {
  private readonly logger = new Logger(ClickQueue.name);

  constructor(@InjectQueue('clicks') private readonly clicksQueue: Queue) {}

  async addClickJob(data: ClickJobData): Promise<void> {
    try {
      await this.clicksQueue.add('log-click', data, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: true,
        removeOnFail: 100,
      });
    } catch (error) {
      this.logger.error(`Failed to enqueue click job for code: ${data.shortCode}`, error);
    }
  }
}
