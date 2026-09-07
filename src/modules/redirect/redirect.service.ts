import { Injectable, NotFoundException, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import Redis from 'ioredis';
import * as crypto from 'crypto';
import { Url, UrlDocument } from '../url/schemas/url.schema';
import { ClickQueue } from '../queue/click.queue';
import { getRedisConfig } from '../../config/redis.config';

@Injectable()
export class RedirectService implements OnModuleDestroy {
  private readonly logger = new Logger(RedirectService.name);
  private readonly redis: Redis;
  private readonly CACHE_TTL = 3600; // 1 hour TTL in seconds

  constructor(
    @InjectModel(Url.name) private readonly urlModel: Model<UrlDocument>,
    private readonly clickQueue: ClickQueue,
    private readonly configService: ConfigService,
  ) {
    const redisOptions = getRedisConfig(this.configService);
    this.redis = new Redis(redisOptions);
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }

  private hashIp(ip: string): string {
    if (!ip) return 'anonymous';
    return crypto.createHash('sha256').update(ip).digest('hex');
  }

  get frontendUrl(): string {
    const origin = this.configService.get<string>('FRONTEND_URL') || this.configService.get<string>('CORS_ORIGIN');
    if (origin && origin !== '*') {
      return origin.split(',')[0].trim();
    }
    return this.configService.get<string>('BASE_URL', 'http://localhost:3000');
  }

  async getLongUrlAndLogClick(
    shortCode: string,
    reqIp: string,
    referrer: string | null,
    userAgent: string | null,
    isQrScan?: boolean,
    utms?: {
      utmSource?: string | null;
      utmMedium?: string | null;
      utmCampaign?: string | null;
      utmTerm?: string | null;
      utmContent?: string | null;
    },
  ): Promise<string | { passwordProtected: true; redirectUrl: string }> {
    const cacheKey = `url:${shortCode}`;
    const protectedRedirectUrl = `${this.frontendUrl}/protected/${shortCode}`;

    // 1. Check Redis Cache
    let cachedValue: string | null = null;
    try {
      cachedValue = await this.redis.get(cacheKey);
    } catch (err: any) {
      this.logger.warn(`Redis get failed for key ${cacheKey}: ${err?.message}`);
    }

    if (cachedValue === '__PASSWORD_PROTECTED__') {
      return { passwordProtected: true, redirectUrl: protectedRedirectUrl };
    }

    let longUrl: string | null = cachedValue;

    if (!longUrl) {
      // 2. Query MongoDB on cache miss
      const urlDoc = await this.urlModel.findOne({ shortCode }).exec();

      if (!urlDoc) {
        throw new NotFoundException('Short URL not found');
      }

      // Check expiration
      if (urlDoc.expiresAt && new Date(urlDoc.expiresAt) < new Date()) {
        throw new NotFoundException('Short URL has expired');
      }

      // If link is password protected, cache marker and return 302 redirect to frontend password page
      if (urlDoc.passwordHash) {
        try {
          await this.redis.setex(cacheKey, this.CACHE_TTL, '__PASSWORD_PROTECTED__');
        } catch (err: any) {
          this.logger.warn(`Redis setex failed for key ${cacheKey}: ${err?.message}`);
        }
        return { passwordProtected: true, redirectUrl: protectedRedirectUrl };
      }

      longUrl = urlDoc.longUrl;

      // Populate Redis cache for unprotected link
      try {
        await this.redis.setex(cacheKey, this.CACHE_TTL, longUrl);
      } catch (err: any) {
        this.logger.warn(`Redis setex failed for key ${cacheKey}: ${err?.message}`);
      }
    }

    // 3. Enqueue click job to BullMQ (fire-and-forget, do not await completion before returning)
    const ipHash = this.hashIp(reqIp);
    this.clickQueue.addClickJob({
      shortCode,
      timestamp: new Date().toISOString(),
      referrer: referrer || null,
      userAgent: userAgent || null,
      ipHash,
      rawIp: reqIp,
      country: null,
      isQrScan: Boolean(isQrScan),
      utmSource: utms?.utmSource || null,
      utmMedium: utms?.utmMedium || null,
      utmCampaign: utms?.utmCampaign || null,
      utmTerm: utms?.utmTerm || null,
      utmContent: utms?.utmContent || null,
    });

    return longUrl;
  }
}
