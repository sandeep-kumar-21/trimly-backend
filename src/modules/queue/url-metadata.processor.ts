import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UrlMetadataJobData } from './url-metadata.queue';
import { Url, UrlDocument } from '../url/schemas/url.schema';
import { TitleScraperUtil } from '../../common/utils/title-scraper.util';

@Processor('url-metadata')
export class UrlMetadataProcessor extends WorkerHost {
  private readonly logger = new Logger(UrlMetadataProcessor.name);

  constructor(
    @InjectModel(Url.name) private readonly urlModel: Model<UrlDocument>,
  ) {
    super();
  }

  async process(job: Job<UrlMetadataJobData>): Promise<any> {
    const { shortCode, shortCodes, longUrl } = job.data;
    const targetCodes =
      shortCodes && shortCodes.length > 0
        ? shortCodes
        : shortCode
          ? [shortCode]
          : [];

    if (targetCodes.length === 0) return;

    this.logger.debug(
      `Processing scrape-title job for ${targetCodes.length} codes: [${targetCodes.join(', ')}] (${longUrl})`,
    );

    try {
      const extractedTitle = await TitleScraperUtil.scrapeTitle(longUrl);

      if (extractedTitle) {
        // Update all target shortCodes in 1 single MongoDB updateMany
        const result = await this.urlModel.updateMany(
          {
            shortCode: { $in: targetCodes },
            $or: [{ title: null }, { title: '' }],
          },
          {
            $set: { title: extractedTitle },
          },
        );

        if (result.modifiedCount > 0) {
          this.logger.log(
            `Successfully auto-populated title for ${result.modifiedCount}/${targetCodes.length} links [${targetCodes.join(', ')}]: "${extractedTitle}"`,
          );
        } else {
          this.logger.debug(
            `Titles for [${targetCodes.join(', ')}] were already set or modified; skipping.`,
          );
        }
      } else {
        this.logger.debug(`No title could be scraped for ${longUrl}.`);
      }
    } catch (err: any) {
      this.logger.warn(
        `Failed to process scrape-title job for [${targetCodes.join(', ')}]: ${err.message}`,
      );
    }
  }
}
