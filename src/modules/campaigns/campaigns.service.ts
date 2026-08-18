import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Inject, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Campaign, CampaignDocument } from './schemas/campaign.schema';
import { Url, UrlDocument } from '../url/schemas/url.schema';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { REDIS_CLIENT } from '../../common/redis/redis.provider';

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);
  private readonly AGGREGATION_CACHE_TTL = 120; // 120 seconds TTL to absorb repeated dashboard queries without heavy DB recalculation

  constructor(
    @InjectModel(Campaign.name) private readonly campaignModel: Model<CampaignDocument>,
    @InjectModel(Url.name) private readonly urlModel: Model<UrlDocument>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly configService: ConfigService,
  ) {}

  private get baseUrl(): string {
    return this.configService.get<string>('BASE_URL', 'http://localhost:3000');
  }

  get shortUrlBase(): string {
    return this.configService.get<string>('SHORT_URL_BASE', 'http://localhost:4000');
  }

  private formatCampaignResponse(campaignDoc: CampaignDocument) {
    const obj = campaignDoc.toObject ? campaignDoc.toObject() : campaignDoc;
    return {
      ...obj,
      id: obj._id ? obj._id.toString() : undefined,
    };
  }

  async createCampaign(createCampaignDto: CreateCampaignDto, userId: string) {
    const createdCampaign = new this.campaignModel({
      name: createCampaignDto.name,
      description: createCampaignDto.description || null,
      userId: new Types.ObjectId(userId),
    });

    const saved = await createdCampaign.save();

    // Invalidate campaign list cache for this user
    try {
      await this.redis.del(`campaigns:${userId}`);
    } catch {}

    return this.formatCampaignResponse(saved);
  }

  async getUserCampaigns(userId: string) {
    const cacheKey = `campaigns:${userId}`;

    /* Performance optimization: Cache aggregated campaign totals in Redis for 120 seconds
       to prevent expensive Mongo aggregations on frequent dashboard reloads. */
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err: any) {
      this.logger.warn(`Redis lookup failed for key ${cacheKey}: ${err.message}`);
    }

    const userObjectId = new Types.ObjectId(userId);
    const campaigns = await this.campaignModel
      .find({ userId: userObjectId })
      .sort({ createdAt: -1 })
      .exec();

    // Aggregate link counts and click totals per campaign for this user
    const stats = await this.urlModel.aggregate([
      { $match: { userId: userObjectId, campaignId: { $ne: null } } },
      {
        $group: {
          _id: '$campaignId',
          totalLinks: { $sum: 1 },
          totalClicks: { $sum: '$clickCount' },
        },
      },
    ]);

    const statsMap = new Map<string, { totalLinks: number; totalClicks: number }>();
    stats.forEach((item) => {
      if (item._id) {
        statsMap.set(item._id.toString(), {
          totalLinks: item.totalLinks,
          totalClicks: item.totalClicks,
        });
      }
    });

    const result = campaigns.map((campaign) => {
      const formatted = this.formatCampaignResponse(campaign);
      const s = statsMap.get(formatted._id.toString()) || { totalLinks: 0, totalClicks: 0 };
      return {
        ...formatted,
        totalLinks: s.totalLinks,
        totalClicks: s.totalClicks,
      };
    });

    try {
      await this.redis.setex(cacheKey, this.AGGREGATION_CACHE_TTL, JSON.stringify(result));
    } catch (err: any) {
      this.logger.warn(`Redis setex failed for key ${cacheKey}: ${err.message}`);
    }

    return result;
  }

  async getCampaignDetails(id: string, userId: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid campaign ID');
    }

    const cacheKey = `campaign:${id}`;

    /* Performance optimization: Cache campaign detail aggregation pipeline result in Redis for 120s
       to absorb repeated loads of campaign analytics screens. */
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err: any) {
      this.logger.warn(`Redis lookup failed for key ${cacheKey}: ${err.message}`);
    }

    const campaignObjectId = new Types.ObjectId(id);
    const userObjectId = new Types.ObjectId(userId);

    const campaignDoc = await this.campaignModel
      .findOne({ _id: campaignObjectId, userId: userObjectId })
      .exec();

    if (!campaignDoc) {
      throw new NotFoundException('Campaign not found');
    }

    // Aggregation pipeline to group links by channel and compute click totals
    const channelAggregation = await this.urlModel.aggregate([
      {
        $match: {
          campaignId: campaignObjectId,
          userId: userObjectId,
        },
      },
      {
        $group: {
          _id: { $ifNull: ['$channel', 'other'] },
          totalClicks: { $sum: '$clickCount' },
          totalLinks: { $sum: 1 },
          links: {
            $push: {
              _id: '$_id',
              shortCode: '$shortCode',
              longUrl: '$longUrl',
              clickCount: '$clickCount',
              channel: '$channel',
              createdAt: '$createdAt',
              expiresAt: '$expiresAt',
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          channel: '$_id',
          totalClicks: 1,
          totalLinks: 1,
          links: 1,
        },
      },
    ]);

    let overallTotalClicks = 0;
    let overallTotalLinks = 0;

    const channels = channelAggregation.map((ch) => {
      overallTotalClicks += ch.totalClicks;
      overallTotalLinks += ch.totalLinks;

      const formattedLinks = ch.links.map((link: any) => ({
        ...link,
        id: link._id ? link._id.toString() : undefined,
        shortUrl: `${this.shortUrlBase}/${link.shortCode}`,
      }));

      return {
        channel: ch.channel,
        totalClicks: ch.totalClicks,
        totalLinks: ch.totalLinks,
        links: formattedLinks,
      };
    });

    const result = {
      campaign: this.formatCampaignResponse(campaignDoc),
      totalClicks: overallTotalClicks,
      totalLinks: overallTotalLinks,
      channels,
    };

    try {
      await this.redis.setex(cacheKey, this.AGGREGATION_CACHE_TTL, JSON.stringify(result));
    } catch (err: any) {
      this.logger.warn(`Redis setex failed for key ${cacheKey}: ${err.message}`);
    }

    return result;
  }

  async updateCampaign(id: string, updateCampaignDto: UpdateCampaignDto, userId: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid campaign ID');
    }

    const campaignObjectId = new Types.ObjectId(id);
    const userObjectId = new Types.ObjectId(userId);

    const campaignDoc = await this.campaignModel
      .findOne({ _id: campaignObjectId, userId: userObjectId })
      .exec();

    if (!campaignDoc) {
      throw new NotFoundException('Campaign not found');
    }

    if (updateCampaignDto.name !== undefined) {
      campaignDoc.name = updateCampaignDto.name;
    }
    if (updateCampaignDto.description !== undefined) {
      campaignDoc.description = updateCampaignDto.description || null;
    }

    const updated = await campaignDoc.save();

    // Cache invalidation: invalidate campaign list & campaign detail keys in Redis
    try {
      await Promise.all([
        this.redis.del(`campaigns:${userId}`),
        this.redis.del(`campaign:${id}`),
      ]);
    } catch {}

    return this.formatCampaignResponse(updated);
  }

  async deleteCampaign(id: string, userId: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid campaign ID');
    }

    const campaignObjectId = new Types.ObjectId(id);
    const userObjectId = new Types.ObjectId(userId);

    const campaignDoc = await this.campaignModel
      .findOne({ _id: campaignObjectId, userId: userObjectId })
      .exec();

    if (!campaignDoc) {
      throw new NotFoundException('Campaign not found');
    }

    // Un-link associated Url documents by setting their campaignId to null (does not delete the Urls)
    await this.urlModel
      .updateMany(
        { campaignId: campaignObjectId, userId: userObjectId },
        { $set: { campaignId: null } },
      )
      .exec();

    // Delete the campaign document
    await this.campaignModel.deleteOne({ _id: campaignObjectId }).exec();

    // Cache invalidation: invalidate list and detail keys in Redis
    try {
      await Promise.all([
        this.redis.del(`campaigns:${userId}`),
        this.redis.del(`campaign:${id}`),
      ]);
    } catch {}

    return { message: 'Campaign successfully deleted and associated links unlinked' };
  }
}
