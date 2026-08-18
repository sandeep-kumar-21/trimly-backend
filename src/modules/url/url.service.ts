import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Types, Connection, ClientSession } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import * as bcrypt from 'bcrypt';
import { Url, UrlDocument } from './schemas/url.schema';
import { QrCode, QrCodeDocument } from '../qrcodes/schemas/qrcode.schema';
import { Counter, CounterDocument } from '../../database/counter.schema';
import { CreateUrlDto } from './dto/create-url.dto';
import { UpdateUrlDto } from './dto/update-url.dto';
import { EditBackHalfDto } from './dto/edit-back-half.dto';
import { BulkTagsDto } from './dto/bulk-tags.dto';
import { BulkHideDto } from './dto/bulk-hide.dto';
import { Base62Util } from '../../common/utils/base62.util';
import { REDIS_CLIENT } from '../../common/redis/redis.provider';

@Injectable()
export class UrlService {
  constructor(
    @InjectModel(Url.name) private readonly urlModel: Model<UrlDocument>,
    @InjectModel(QrCode.name) private readonly qrCodeModel: Model<QrCodeDocument>,
    @InjectModel(Counter.name) private readonly counterModel: Model<CounterDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly configService: ConfigService,
  ) {}

  private get baseUrl(): string {
    return this.configService.get<string>('BASE_URL', 'http://localhost:3000');
  }

  get shortUrlBase(): string {
    return this.configService.get<string>('SHORT_URL_BASE', 'http://localhost:4000');
  }

  private formatUrlResponse(urlDoc: UrlDocument) {
    const obj = urlDoc.toObject ? urlDoc.toObject() : { ...urlDoc };
    const { passwordHash, ...cleanObj } = obj as any;
    return {
      ...cleanObj,
      id: cleanObj._id ? cleanObj._id.toString() : undefined,
      shortUrl: `${this.shortUrlBase}/${cleanObj.shortCode}`,
      passwordProtected: !!passwordHash,
      visibleAsLink: cleanObj.visibleAsLink !== undefined ? cleanObj.visibleAsLink : true,
      hasQR: cleanObj.hasQR !== undefined ? cleanObj.hasQR : false,
      qrCodeId: cleanObj.qrCodeId ? cleanObj.qrCodeId.toString() : null,
      isCustomAlias: cleanObj.isCustomAlias !== undefined ? cleanObj.isCustomAlias : false,
    };
  }

  private appendUtmParams(
    longUrl: string,
    utm: {
      utmSource?: string;
      utmMedium?: string;
      utmCampaign?: string;
      utmTerm?: string;
      utmContent?: string;
    },
  ): string {
    const utmParams = new URLSearchParams();
    if (utm.utmSource) utmParams.append('utm_source', utm.utmSource);
    if (utm.utmMedium) utmParams.append('utm_medium', utm.utmMedium);
    if (utm.utmCampaign) utmParams.append('utm_campaign', utm.utmCampaign);
    if (utm.utmTerm) utmParams.append('utm_term', utm.utmTerm);
    if (utm.utmContent) utmParams.append('utm_content', utm.utmContent);

    const queryString = utmParams.toString();
    if (!queryString) return longUrl;

    return longUrl.includes('?') ? `${longUrl}&${queryString}` : `${longUrl}?${queryString}`;
  }

  async createUrl(
    createUrlDto: CreateUrlDto,
    userId?: string | null,
    options?: { visibleAsLink?: boolean; session?: ClientSession },
  ) {
    const {
      longUrl,
      customAlias,
      expiresAt,
      campaignId,
      channel,
      title,
      tags,
      password,
      utmSource,
      utmMedium,
      utmCampaign,
      utmTerm,
      utmContent,
    } = createUrlDto;
    let shortCode: string;
    const isCustomAlias = Boolean(customAlias);

    if (customAlias) {
      const existingQuery = this.urlModel.findOne({ shortCode: customAlias });
      if (options?.session) {
        existingQuery.session(options.session);
      }
      const existing = await existingQuery.exec();
      if (existing) {
        throw new ConflictException('Custom alias is already taken');
      }
      shortCode = customAlias;
    } else {
      const counterOptions: any = { upsert: true, new: true, setDefaultsOnInsert: true };
      if (options?.session) {
        counterOptions.session = options.session;
      }
      const counter: any = await this.counterModel.findOneAndUpdate(
        { _id: 'urlCounter' } as any,
        { $inc: { seq: 1 } },
        counterOptions,
      );
      shortCode = Base62Util.encode(counter.seq);
    }

    const finalLongUrl = this.appendUtmParams(longUrl, {
      utmSource,
      utmMedium,
      utmCampaign,
      utmTerm,
      utmContent,
    });

    let passwordHash: string | null = null;
    if (password) {
      passwordHash = await bcrypt.hash(password, 10);
    }

    const visibleAsLink = options?.visibleAsLink !== undefined ? options.visibleAsLink : true;

    const createdUrl = new this.urlModel({
      shortCode,
      longUrl: finalLongUrl,
      title: title || null,
      tags: tags || [],
      passwordHash,
      utmSource: utmSource || null,
      utmMedium: utmMedium || null,
      utmCampaign: utmCampaign || null,
      utmTerm: utmTerm || null,
      utmContent: utmContent || null,
      userId: userId ? new Types.ObjectId(userId) : null,
      campaignId: campaignId ? new Types.ObjectId(campaignId) : null,
      channel: channel ? channel.toLowerCase() : null,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      visibleAsLink,
      hasQR: false,
      qrCodeId: null,
      isCustomAlias,
    });

    const saved = options?.session ? await createdUrl.save({ session: options.session }) : await createdUrl.save();
    return this.formatUrlResponse(saved);
  }

  async getUrlMetadata(shortCode: string) {
    const urlDoc = await this.urlModel.findOne({ shortCode }).exec();
    if (!urlDoc) {
      throw new NotFoundException('Short URL not found');
    }
    return this.formatUrlResponse(urlDoc);
  }

  async getUserUrls(
    userId: string,
    filterOptions?: {
      tags?: string[];
      linkType?: 'all' | 'custom' | 'auto';
      qrAttachment?: 'all' | 'with' | 'without';
    },
  ) {
    const query: any = {
      userId: new Types.ObjectId(userId),
      visibleAsLink: true, // Default visibility rule: QR-only links never appear in Links list
    };

    if (filterOptions?.tags && filterOptions.tags.length > 0) {
      query.tags = { $in: filterOptions.tags };
    }

    if (filterOptions?.linkType === 'custom') {
      query.isCustomAlias = true;
    } else if (filterOptions?.linkType === 'auto') {
      query.isCustomAlias = false;
    }

    if (filterOptions?.qrAttachment === 'with') {
      query.hasQR = true;
    } else if (filterOptions?.qrAttachment === 'without') {
      query.hasQR = false;
    }

    const urls = await this.urlModel
      .find(query)
      .sort({ createdAt: -1 })
      .exec();

    return urls.map((u) => this.formatUrlResponse(u));
  }

  async updateUrl(shortCode: string, updateUrlDto: UpdateUrlDto, userId: string) {
    const urlDoc = await this.urlModel.findOne({ shortCode }).exec();
    if (!urlDoc) {
      throw new NotFoundException('Short URL not found');
    }

    if (!urlDoc.userId || urlDoc.userId.toString() !== userId) {
      throw new ForbiddenException('You do not have permission to modify this short URL');
    }

    if (updateUrlDto.longUrl !== undefined) {
      urlDoc.longUrl = updateUrlDto.longUrl;
    }

    if (updateUrlDto.expiresAt !== undefined) {
      urlDoc.expiresAt = updateUrlDto.expiresAt ? new Date(updateUrlDto.expiresAt) : null;
    }

    if (updateUrlDto.title !== undefined) {
      urlDoc.title = updateUrlDto.title || null;
    }

    if (updateUrlDto.campaignId !== undefined) {
      urlDoc.campaignId = updateUrlDto.campaignId
        ? new Types.ObjectId(updateUrlDto.campaignId)
        : null;
    }

    if (updateUrlDto.channel !== undefined) {
      urlDoc.channel = updateUrlDto.channel ? updateUrlDto.channel.toLowerCase() : null;
    }

    if (updateUrlDto.tags !== undefined) {
      urlDoc.tags = updateUrlDto.tags || [];
    }

    if (updateUrlDto.password !== undefined) {
      if (updateUrlDto.password) {
        urlDoc.passwordHash = await bcrypt.hash(updateUrlDto.password, 10);
      } else {
        urlDoc.passwordHash = null;
      }
    }

    if (updateUrlDto.isHidden !== undefined) {
      urlDoc.isHidden = updateUrlDto.isHidden;
    }

    if (updateUrlDto.visibleAsLink !== undefined) {
      urlDoc.visibleAsLink = updateUrlDto.visibleAsLink;
    }

    const updated = await urlDoc.save();

    // Cache Invalidation: DEL url:{shortCode} entry in Redis so stale redirect target is immediately cleared upon update
    try {
      await this.redis.del(`url:${shortCode}`);
    } catch (err: any) {
      // Non-blocking log warning if Redis flush fails
    }

    return this.formatUrlResponse(updated);
  }

  async deleteUrl(shortCode: string, userId: string) {
    const urlDoc = await this.urlModel.findOne({ shortCode }).exec();
    if (!urlDoc) {
      throw new NotFoundException('Short URL not found');
    }

    if (!urlDoc.userId || urlDoc.userId.toString() !== userId) {
      throw new ForbiddenException('You do not have permission to delete this short URL');
    }

    // Cascade delete linked QR code if present
    if (urlDoc.hasQR || urlDoc.qrCodeId) {
      await this.qrCodeModel.deleteOne({ shortCode }).exec();
      // Invalidate Redis QR caches
      try {
        const qrKeys = await this.redis.keys(`qr:${shortCode}:*`);
        if (qrKeys.length > 0) {
          await this.redis.del(...qrKeys);
        }
      } catch (err: any) {}
    }

    await this.urlModel.deleteOne({ _id: urlDoc._id }).exec();

    // Cache Invalidation: DEL url:{shortCode} entry in Redis
    try {
      await this.redis.del(`url:${shortCode}`);
    } catch (err: any) {}

    return { message: 'Short URL and any linked QR code successfully deleted' };
  }

  async promoteToLink(shortCode: string, userId: string) {
    const urlDoc = await this.urlModel.findOne({ shortCode }).exec();
    if (!urlDoc) {
      throw new NotFoundException('Short URL not found');
    }

    if (!urlDoc.userId || urlDoc.userId.toString() !== userId) {
      throw new ForbiddenException('You do not have permission to promote this short URL');
    }

    urlDoc.visibleAsLink = true;
    const updated = await urlDoc.save();

    // Invalidate Redis cache entry if needed
    try {
      await this.redis.del(`url:${shortCode}`);
    } catch (err: any) {}

    return this.formatUrlResponse(updated);
  }

  async editBackHalf(
    sourceCode: string,
    userId: string,
    dto: EditBackHalfDto,
  ) {
    const sourceUrl = await this.urlModel.findOne({ shortCode: sourceCode }).exec();
    if (!sourceUrl) {
      throw new NotFoundException('Source short URL not found');
    }

    if (!sourceUrl.userId || sourceUrl.userId.toString() !== userId) {
      throw new ForbiddenException('You do not have permission to modify this short URL');
    }

    const newAlias = dto.customAlias.trim();
    if (!newAlias) {
      throw new BadRequestException('Custom alias cannot be empty');
    }

    if (newAlias === sourceCode) {
      // If alias did not change, update in-place
      return this.updateUrl(sourceCode, {
        longUrl: dto.longUrl,
        title: dto.title,
        tags: dto.tags,
      }, userId);
    }

    // Check custom alias availability
    const existing = await this.urlModel.findOne({ shortCode: newAlias }).exec();
    if (existing) {
      throw new ConflictException('Custom alias is already taken');
    }

    // Copy all source document fields server-side (prevents missing campaign, channel, expiresAt, UTM fields, etc.)
    const sourceObj = sourceUrl.toObject();
    delete (sourceObj as any)._id;
    delete (sourceObj as any).createdAt;
    delete (sourceObj as any).hasQR;
    delete (sourceObj as any).qrCodeId;

    const newUrlDoc = new this.urlModel({
      ...sourceObj,
      shortCode: newAlias,
      isCustomAlias: true,
      longUrl: dto.longUrl !== undefined ? dto.longUrl : sourceUrl.longUrl,
      title: dto.title !== undefined ? (dto.title || null) : sourceUrl.title,
      tags: dto.tags !== undefined ? (dto.tags || []) : sourceUrl.tags,
      clickCount: 0,
      visibleAsLink: true,
      createdAt: new Date(),
    });

    const saved = await newUrlDoc.save();
    return this.formatUrlResponse(saved);
  }

  async verifyPassword(shortCode: string, password: string) {
    const urlDoc = await this.urlModel.findOne({ shortCode }).exec();
    if (!urlDoc) {
      throw new NotFoundException('Short URL not found');
    }

    if (!urlDoc.passwordHash) {
      return { success: true, longUrl: urlDoc.longUrl };
    }

    const isMatch = await bcrypt.compare(password, urlDoc.passwordHash);
    if (!isMatch) {
      throw new BadRequestException('Invalid link password');
    }

    return { success: true, longUrl: urlDoc.longUrl };
  }

  async getDistinctTags(userId: string) {
    const tags = await this.urlModel.distinct('tags', { userId: new Types.ObjectId(userId) }).exec();
    return tags || [];
  }

  async bulkUpdateTags(userId: string, bulkTagsDto: BulkTagsDto) {
    const { linkIds, addTags, removeTags } = bulkTagsDto;
    
    // First, verify all linkIds belong to the user
    const objectIds = linkIds.map(id => new Types.ObjectId(id));
    const validLinksCount = await this.urlModel.countDocuments({
      _id: { $in: objectIds },
      userId: new Types.ObjectId(userId)
    }).exec();

    if (validLinksCount !== linkIds.length) {
      throw new ForbiddenException('One or more links do not belong to the authenticated user, or do not exist');
    }

    // Perform updates
    if (addTags && addTags.length > 0) {
      await this.urlModel.updateMany(
        { _id: { $in: objectIds } },
        { $addToSet: { tags: { $each: addTags } } }
      ).exec();
    }

    if (removeTags && removeTags.length > 0) {
      await this.urlModel.updateMany(
        { _id: { $in: objectIds } },
        { $pull: { tags: { $in: removeTags } } }
      ).exec();
    }

    // Return the updated links
    const updatedLinks = await this.urlModel.find({ _id: { $in: objectIds } }).exec();
    
    // Attempt cache invalidation for the affected links
    try {
      for (const link of updatedLinks) {
        await this.redis.del(`url:${link.shortCode}`);
      }
    } catch (err: any) {
      // Non-blocking
    }

    return updatedLinks.map((u) => this.formatUrlResponse(u));
  }

  async bulkHideUrls(userId: string, bulkHideDto: BulkHideDto) {
    const { linkIds, isHidden } = bulkHideDto;

    const objectIds = linkIds.map(id => new Types.ObjectId(id));
    const validLinksCount = await this.urlModel.countDocuments({
      _id: { $in: objectIds },
      userId: new Types.ObjectId(userId)
    }).exec();

    if (validLinksCount !== linkIds.length) {
      throw new ForbiddenException('One or more links do not belong to the authenticated user, or do not exist');
    }

    await this.urlModel.updateMany(
      { _id: { $in: objectIds } },
      { $set: { isHidden } }
    ).exec();

    const updatedLinks = await this.urlModel.find({ _id: { $in: objectIds } }).exec();
    const shortCodes = updatedLinks.map((u) => u.shortCode).filter(Boolean);
    if (shortCodes.length > 0) {
      await this.qrCodeModel.updateMany(
        { shortCode: { $in: shortCodes } },
        { $set: { isHidden } }
      ).exec();
    }

    return updatedLinks.map((u) => this.formatUrlResponse(u));
  }
}
