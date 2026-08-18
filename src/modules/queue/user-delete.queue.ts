import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export interface DeleteUserAccountJobData {
  userId: string;
  jobId: string;
}

@Injectable()
export class UserDeleteQueue {
  private readonly logger = new Logger(UserDeleteQueue.name);

  constructor(
    @InjectQueue('delete-user-account') private readonly deleteQueue: Queue<DeleteUserAccountJobData>,
  ) {}

  async addDeleteJob(data: DeleteUserAccountJobData) {
    try {
      const job = await this.deleteQueue.add('delete-user-account', data, {
        jobId: data.jobId,
        removeOnComplete: true,
        removeOnFail: false,
      });
      this.logger.log(`Queued delete-user-account job: ${job.id} for user: ${data.userId}`);
      return job;
    } catch (err: any) {
      this.logger.error(`Failed to queue delete-user-account job: ${err.message}`, err.stack);
      throw err;
    }
  }
}
