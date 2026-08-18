import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export interface ExportUserDataJobData {
  userId: string;
  jobId: string;
}

@Injectable()
export class UserExportQueue {
  private readonly logger = new Logger(UserExportQueue.name);

  constructor(
    @InjectQueue('export-user-data') private readonly exportQueue: Queue<ExportUserDataJobData>,
  ) {}

  async addExportJob(data: ExportUserDataJobData) {
    try {
      const job = await this.exportQueue.add('export-user-data', data, {
        jobId: data.jobId,
        removeOnComplete: true,
        removeOnFail: false,
      });
      this.logger.log(`Queued export-user-data job: ${job.id} for user: ${data.userId}`);
      return job;
    } catch (err: any) {
      this.logger.error(`Failed to queue export-user-data job: ${err.message}`, err.stack);
      throw err;
    }
  }
}
