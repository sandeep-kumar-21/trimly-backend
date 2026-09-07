import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Inject, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Campaign, CampaignDocument } from './schemas/campaign.schema';
import { Url, UrlDocument } from '../url/schemas/url.schema';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { AddCampaignLinksDto } from './dto/add-campaign-links.dto';
import { AssignExistingLinksDto } from './dto/assign-existing-links.dto';
import { UrlService } from '../url/url.service';
import { UrlMetadataQueue } from '../queue/url-metadata.queue';
import { REDIS_CLIENT } from '../../common/redis/redis.provider';

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);
  private readonly AGGREGATION_CACHE_TTL = 120; // 120s TTL
  private readonly CHANNELS_CACHE_TTL = 300; // 300s TTL

  constructor(
    @InjectModel(Campaign.name) private readonly campaignModel: Model<CampaignDocument>,
    @InjectModel(Url.name) private readonly urlModel: Model<UrlDocument>,
    private readonly urlService: UrlService,
    private readonly urlMetadataQueue: UrlMetadataQueue,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly configService: ConfigService,
  ) {}

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

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  private appendUtmParams(
    longUrl: string,
    utm: {
      utmSource?: string;
      utmMedium?: string;
      utmCampaign?: string;
    },
  ): string {
    try {
      const url = new URL(longUrl);
      if (utm.utmSource) url.searchParams.set('utm_source', utm.utmSource);
      if (utm.utmMedium) url.searchParams.set('utm_medium', utm.utmMedium);
      if (utm.utmCampaign) url.searchParams.set('utm_campaign', utm.utmCampaign);
      return url.toString();
    } catch {
      const params: string[] = [];
      if (utm.utmSource) params.push(`utm_source=${encodeURIComponent(utm.utmSource)}`);
      if (utm.utmMedium) params.push(`utm_medium=${encodeURIComponent(utm.utmMedium)}`);
      if (utm.utmCampaign) params.push(`utm_campaign=${encodeURIComponent(utm.utmCampaign)}`);
      if (params.length === 0) return longUrl;
      const separator = longUrl.includes('?') ? '&' : '?';
      return `${longUrl}${separator}${params.join('&')}`;
    }
  }

  async createCampaign(createCampaignDto: CreateCampaignDto, userId: string) {
    const channels =
      createCampaignDto.channels && createCampaignDto.channels.length > 0
        ? Array.from(new Set(createCampaignDto.channels.map((c) => c.toLowerCase().trim()).filter(Boolean)))
        : ['email', 'social', 'sms', 'paid'];

    const createdCampaign = new this.campaignModel({
      name: createCampaignDto.name.trim(),
      description: createCampaignDto.description?.trim() || null,
      channels,
      userId: new Types.ObjectId(userId),
    });

    const saved = await createdCampaign.save();

    // Invalidate Redis caches
    try {
      await Promise.all([
        this.redis.del(`campaigns:${userId}`),
        this.redis.del(`campaign-channels:${userId}`),
      ]);
    } catch {}

    return this.formatCampaignResponse(saved);
  }

  async getUserCampaigns(userId: string) {
    const cacheKey = `campaigns:${userId}`;

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

    // Aggregate link counts, total clicks, and top channel per campaign
    const stats = await this.urlModel.aggregate([
      { $match: { userId: userObjectId, campaignId: { $ne: null } } },
      {
        $group: {
          _id: {
            campaignId: '$campaignId',
            channel: { $ifNull: ['$channel', 'other'] },
          },
          channelClicks: { $sum: '$clickCount' },
          channelLinks: { $sum: 1 },
        },
      },
    ]);

    const campaignStatsMap = new Map<
      string,
      { totalLinks: number; totalClicks: number; topChannel: { channel: string; clicks: number } | null }
    >();

    stats.forEach((item) => {
      const cId = item._id.campaignId?.toString();
      if (!cId) return;

      const existing = campaignStatsMap.get(cId) || {
        totalLinks: 0,
        totalClicks: 0,
        topChannel: null,
      };

      existing.totalLinks += item.channelLinks;
      existing.totalClicks += item.channelClicks;

      if (!existing.topChannel || item.channelClicks > existing.topChannel.clicks) {
        existing.topChannel = {
          channel: item._id.channel,
          clicks: item.channelClicks,
        };
      }

      campaignStatsMap.set(cId, existing);
    });

    const result = campaigns.map((campaign) => {
      const formatted = this.formatCampaignResponse(campaign);
      const s = campaignStatsMap.get(formatted._id.toString()) || {
        totalLinks: 0,
        totalClicks: 0,
        topChannel: null,
      };
      return {
        ...formatted,
        totalLinks: s.totalLinks,
        totalClicks: s.totalClicks,
        topChannel: s.topChannel,
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
              title: '$title',
              tags: '$tags',
              clickCount: '$clickCount',
              channel: '$channel',
              utmSource: '$utmSource',
              utmMedium: '$utmMedium',
              utmCampaign: '$utmCampaign',
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
    let topChannelObj: { channel: string; clicks: number } | null = null;

    // Build map of channels with links
    const aggregatedMap = new Map<string, any>();
    channelAggregation.forEach((ch) => {
      overallTotalClicks += ch.totalClicks;
      overallTotalLinks += ch.totalLinks;

      if (!topChannelObj || ch.totalClicks > topChannelObj.clicks) {
        topChannelObj = { channel: ch.channel, clicks: ch.totalClicks };
      }

      const formattedLinks = ch.links.map((link: any) => ({
        ...link,
        id: link._id ? link._id.toString() : undefined,
        shortUrl: `${this.shortUrlBase}/${link.shortCode}`,
      }));

      aggregatedMap.set(ch.channel.toLowerCase(), {
        channel: ch.channel,
        totalClicks: ch.totalClicks,
        totalLinks: ch.totalLinks,
        links: formattedLinks,
      });
    });

    // Merge campaign channels so empty channels also show up gracefully
    const configuredChannels = campaignDoc.channels && campaignDoc.channels.length > 0
      ? campaignDoc.channels
      : ['email', 'social', 'sms', 'paid'];

    const channels: any[] = [];
    const seenChannels = new Set<string>();

    // 1. Add configured channels first
    for (const confCh of configuredChannels) {
      const lower = confCh.toLowerCase().trim();
      seenChannels.add(lower);
      const existing = aggregatedMap.get(lower);
      if (existing) {
        const percent = overallTotalClicks > 0 ? Math.round((existing.totalClicks / overallTotalClicks) * 100) : 0;
        channels.push({ ...existing, percentOfClicks: percent });
      } else {
        channels.push({
          channel: confCh,
          totalClicks: 0,
          totalLinks: 0,
          percentOfClicks: 0,
          links: [],
        });
      }
    }

    // 2. Add any other channels that have links but weren't in configured list
    aggregatedMap.forEach((val, key) => {
      if (!seenChannels.has(key)) {
        const percent = overallTotalClicks > 0 ? Math.round((val.totalClicks / overallTotalClicks) * 100) : 0;
        channels.push({ ...val, percentOfClicks: percent });
      }
    });

    const result = {
      campaign: this.formatCampaignResponse(campaignDoc),
      totalClicks: overallTotalClicks,
      totalLinks: overallTotalLinks,
      topChannel: topChannelObj,
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
      campaignDoc.name = updateCampaignDto.name.trim();
    }
    if (updateCampaignDto.description !== undefined) {
      campaignDoc.description = updateCampaignDto.description?.trim() || null;
    }
    if (updateCampaignDto.channels !== undefined) {
      campaignDoc.channels = Array.from(
        new Set(updateCampaignDto.channels.map((c) => c.toLowerCase().trim()).filter(Boolean)),
      );
    }

    const updated = await campaignDoc.save();

    // Invalidate Redis caches
    try {
      await Promise.all([
        this.redis.del(`campaigns:${userId}`),
        this.redis.del(`campaign:${id}`),
        this.redis.del(`campaign-channels:${userId}`),
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

    // Un-link associated Url documents by setting their campaignId and channel to null
    await this.urlModel
      .updateMany(
        { campaignId: campaignObjectId, userId: userObjectId },
        { $set: { campaignId: null, channel: null } },
      )
      .exec();

    // Delete campaign doc
    await this.campaignModel.deleteOne({ _id: campaignObjectId }).exec();

    // Invalidate Redis caches
    try {
      await Promise.all([
        this.redis.del(`campaigns:${userId}`),
        this.redis.del(`campaign:${id}`),
        this.redis.del(`campaign-channels:${userId}`),
      ]);
    } catch {}

    return { message: 'Campaign successfully deleted and associated links unlinked' };
  }

  async addCampaignLinksBatch(id: string, dto: AddCampaignLinksDto, userId: string) {
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

    let baseDestinationUrl = dto.destinationUrl.trim();
    if (!/^https?:\/\//i.test(baseDestinationUrl)) {
      baseDestinationUrl = `https://${baseDestinationUrl}`;
    }

    const campaignSlug = this.slugify(campaignDoc.name);
    const autoUtm = dto.autoUtm !== false;
    const channels = Array.from(new Set(dto.channels.map((c) => c.toLowerCase().trim()).filter(Boolean)));

    const createdLinks: any[] = [];

    for (const ch of channels) {
      const titleForChannel = dto.title
        ? `${dto.title.trim()} – ${ch.charAt(0).toUpperCase() + ch.slice(1)}`
        : undefined;

      const customAliasForChannel = dto.customAliasPrefix
        ? `${dto.customAliasPrefix.trim()}-${ch}`
        : undefined;

      const link = await this.urlService.createUrl(
        {
          longUrl: baseDestinationUrl,
          title: titleForChannel,
          customAlias: customAliasForChannel,
          campaignId: campaignDoc._id.toString(),
          channel: ch,
          utmSource: autoUtm ? ch : undefined,
          utmMedium: autoUtm ? 'trimly' : undefined,
          utmCampaign: autoUtm ? campaignSlug : undefined,
        },
        userId,
        { skipAutoTitleScrape: !dto.title },
      );

      createdLinks.push(link);
    }

    // Queue 1 single BullMQ scrape job for all generated links sharing this destination URL
    if (!dto.title && createdLinks.length > 0) {
      const shortCodes = createdLinks.map((l) => l.shortCode).filter(Boolean);
      if (shortCodes.length > 0) {
        await this.urlMetadataQueue.addScrapeTitleBatchJob({
          shortCodes,
          longUrl: baseDestinationUrl,
        });
      }
    }

    // Ensure any newly specified channels are saved on the campaign doc
    const currentChannels = new Set(campaignDoc.channels || []);
    let modifiedChannels = false;
    for (const ch of channels) {
      if (!currentChannels.has(ch)) {
        currentChannels.add(ch);
        modifiedChannels = true;
      }
    }

    if (modifiedChannels) {
      campaignDoc.channels = Array.from(currentChannels);
      await campaignDoc.save();
    }

    // Invalidate Redis caches
    try {
      await Promise.all([
        this.redis.del(`campaigns:${userId}`),
        this.redis.del(`campaign:${id}`),
        this.redis.del(`campaign-channels:${userId}`),
      ]);
    } catch {}

    return createdLinks;
  }

  async assignExistingLinks(id: string, dto: AssignExistingLinksDto, userId: string) {
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

    const linkObjectIds = dto.linkIds.map((lId) => new Types.ObjectId(lId));
    const validCount = await this.urlModel
      .countDocuments({ _id: { $in: linkObjectIds }, userId: userObjectId })
      .exec();

    if (validCount !== dto.linkIds.length) {
      throw new ForbiddenException('One or more links do not exist or belong to another user');
    }

    const updatePayload: any = { campaignId: campaignObjectId };
    if (dto.channel) {
      const cleanChannel = dto.channel.toLowerCase().trim();
      updatePayload.channel = cleanChannel;

      // Add channel to campaign channels if not present
      if (!campaignDoc.channels.includes(cleanChannel)) {
        campaignDoc.channels.push(cleanChannel);
        await campaignDoc.save();
      }
    }

    await this.urlModel
      .updateMany({ _id: { $in: linkObjectIds }, userId: userObjectId }, { $set: updatePayload })
      .exec();

    // Invalidate Redis caches
    try {
      await Promise.all([
        this.redis.del(`campaigns:${userId}`),
        this.redis.del(`campaign:${id}`),
        this.redis.del(`campaign-channels:${userId}`),
      ]);
    } catch {}

    return { message: `${validCount} links assigned to campaign successfully` };
  }

  async unlinkLinkFromCampaign(id: string, linkId: string, userId: string) {
    if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(linkId)) {
      throw new BadRequestException('Invalid ID');
    }

    const campaignObjectId = new Types.ObjectId(id);
    const linkObjectId = new Types.ObjectId(linkId);
    const userObjectId = new Types.ObjectId(userId);

    const res = await this.urlModel
      .updateOne(
        { _id: linkObjectId, campaignId: campaignObjectId, userId: userObjectId },
        { $set: { campaignId: null, channel: null } },
      )
      .exec();

    if (res.matchedCount === 0) {
      throw new NotFoundException('Link not found in this campaign');
    }

    // Invalidate Redis caches
    try {
      await Promise.all([
        this.redis.del(`campaigns:${userId}`),
        this.redis.del(`campaign:${id}`),
      ]);
    } catch {}

    return { message: 'Link unlinked from campaign successfully' };
  }

  async getUserChannels(userId: string): Promise<string[]> {
    const cacheKey = `campaign-channels:${userId}`;

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch {}

    const userObjectId = new Types.ObjectId(userId);

    const [campaignChannels, urlChannels] = await Promise.all([
      this.campaignModel.distinct('channels', { userId: userObjectId }).exec(),
      this.urlModel.distinct('channel', { userId: userObjectId, channel: { $ne: null } }).exec(),
    ]);

    const defaultChannels = ['email', 'social', 'sms', 'paid', 'linkedin', 'youtube', 'newsletters', 'other'];
    const channelSet = new Set<string>(defaultChannels);

    (campaignChannels || []).forEach((c: string) => {
      if (c && typeof c === 'string') channelSet.add(c.toLowerCase().trim());
    });
    (urlChannels || []).forEach((c: string) => {
      if (c && typeof c === 'string') channelSet.add(c.toLowerCase().trim());
    });

    const result = Array.from(channelSet).filter(Boolean).sort();

    try {
      await this.redis.setex(cacheKey, this.CHANNELS_CACHE_TTL, JSON.stringify(result));
    } catch {}

    return result;
  }
}
