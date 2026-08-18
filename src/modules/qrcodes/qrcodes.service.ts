import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Inject,
  Logger,
} from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Types, Connection, ClientSession } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import * as crypto from 'crypto';
import { REDIS_CLIENT } from '../../common/redis/redis.provider';
import { createCanvas, Image } from 'canvas';
import { JSDOM } from 'jsdom';

if (typeof (global as any).self === 'undefined') {
  (global as any).self = global;
}
if (typeof (global as any).window === 'undefined') {
  (global as any).window = global;
}
if (typeof (global as any).Image === 'undefined') {
  (global as any).Image = Image;
}
if (typeof (global as any).document === 'undefined') {
  (global as any).document = {
    createElement: (tag: string) => {
      if (tag === 'canvas') return createCanvas(1000, 1000);
      if (tag === 'img') return new Image();
      return {};
    },
  };
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const QRCodeStyling = require('qr-code-styling-node');

import { QrCode, QrCodeDocument } from './schemas/qrcode.schema';
import { Url, UrlDocument } from '../url/schemas/url.schema';
import { UrlService } from '../url/url.service';
import { CreateQrCodeDto, QrConfigDto } from './dto/create-qrcode.dto';

export const EXPIRING_DAYS_THRESHOLD = 7;
export const BACKEND_QR_RENDER_SIZE = 1000;

@Injectable()
export class QrCodesService {
  private readonly logger = new Logger(QrCodesService.name);
  private readonly CACHE_TTL = 3600; // 1 hour TTL in seconds for cached QR renders

  constructor(
    @InjectModel(QrCode.name) private readonly qrCodeModel: Model<QrCodeDocument>,
    @InjectModel(Url.name) private readonly urlModel: Model<UrlDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly urlService: UrlService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly configService: ConfigService,
  ) {}

  private get baseUrl(): string {
    return this.configService.get<string>('BASE_URL', 'http://localhost:3000');
  }

  get shortUrlBase(): string {
    return this.configService.get<string>('SHORT_URL_BASE', 'http://localhost:4000');
  }

  private hashConfig(shortCode: string, config: any): string {
    const serialized = JSON.stringify({
      shortCode,
      dotsStyle: config.dotsStyle,
      cornersStyle: config.cornersStyle,
      cornersDotStyle: config.cornersDotStyle,
      dotsColor: config.dotsColor,
      backgroundColor: config.backgroundColor,
      logoUrl: config.logoUrl || null,
      centerText: config.centerText || null,
    });
    return crypto.createHash('md5').update(serialized).digest('hex');
  }

  private isDarkColor(hexColor: string): boolean {
    if (!hexColor || !hexColor.startsWith('#')) return false;
    const hex = hexColor.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16) || 0;
    const g = parseInt(hex.substring(2, 4), 16) || 0;
    const b = parseInt(hex.substring(4, 6), 16) || 0;
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness < 128;
  }

  /**
   * Primary Render Path: Renders scalable Vector SVG string using native type: 'svg' and jsdom.
   */
  async renderQrCodeSvg(shortCode: string, config: QrConfigDto): Promise<string> {
    const targetUrl = `${this.shortUrlBase}/${shortCode}`;
    const hasLogoOrText = !!(config.logoUrl || config.centerText);

    // Rule: Force error correction level "H" automatically whenever logoUrl or centerText is set
    const errorCorrectionLevel = hasLogoOrText ? 'H' : 'M';
    const qrSize = BACKEND_QR_RENDER_SIZE;
    const margin = 70;
    const bgColor = config.backgroundColor || '#ffffff';

    const qrCode = new QRCodeStyling({
      jsdom: JSDOM as any,
      nodeCanvas: createCanvas as any,
      type: 'svg',
      width: qrSize,
      height: qrSize,
      margin,
      data: targetUrl,
      image: config.logoUrl || undefined,
      dotsOptions: {
        color: config.dotsColor || '#000000',
        type: (config.dotsStyle as any) || 'square',
      },
      cornersSquareOptions: {
        type: (config.cornersStyle as any) || 'square',
      },
      cornersDotOptions: {
        type: ((config as any).cornersDotStyle as any) || undefined,
      },
      backgroundOptions: {
        color: bgColor,
      },
      imageOptions: {
        crossOrigin: 'anonymous',
        margin: 10,
        imageSize: 0.3,
      },
      qrOptions: {
        errorCorrectionLevel,
      },
    });

    const raw = await qrCode.getRawData('svg');
    if (!raw) {
      throw new Error('Failed to render QR code SVG');
    }
    let svgString = '';
    if (Buffer.isBuffer(raw)) {
      svgString = raw.toString('utf-8');
    } else if (typeof (raw as any).text === 'function') {
      svgString = await (raw as any).text();
    } else if (typeof (raw as any).arrayBuffer === 'function') {
      const ab = await (raw as any).arrayBuffer();
      svgString = Buffer.from(ab).toString('utf-8');
    } else {
      svgString = String(raw);
    }

    // Ensure responsive viewBox is present on SVG for clean scaling in cards and details containers
    if (!svgString.includes('viewBox')) {
      svgString = svgString.replace(
        /<svg\s+([^>]*?)width="(\d+)"\s+height="(\d+)"([^>]*?)>/i,
        `<svg $1viewBox="0 0 $2 $3" width="100%" height="100%"$4>`,
      );
      if (!svgString.includes('viewBox')) {
        svgString = svgString.replace(/<svg\s+/i, `<svg viewBox="0 0 ${qrSize} ${qrSize}" `);
      }
    }

    // Scope internal SVG IDs uniquely to this shortCode to prevent ID collisions in multi-QR DOM lists
    const sfx = `_${shortCode}`;
    svgString = svgString.replace(/id="([^"]+)"/g, `id="$1${sfx}"`);
    svgString = svgString.replace(/url\('#([^']+)'\)/g, `url('#$1${sfx}')`);
    svgString = svgString.replace(/url\(#([^)]+)\)/g, `url(#$1${sfx})`);
    svgString = svgString.replace(/href="#([^"]+)"/g, `href="#$1${sfx}"`);
    svgString = svgString.replace(/xlink:href="#([^"]+)"/g, `xlink:href="#$1${sfx}"`);

    const isDark = this.isDarkColor(bgColor);
    const textColor = isDark ? '#f8fafc' : '#273144';

    const watermarkSvg = `  <text x="${qrSize - 40}" y="${qrSize - 25}" text-anchor="end" font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="bold" font-style="italic" font-size="28" fill="${textColor}" opacity="0.9">trimly</text>\n</svg>`;

    if (svgString.includes('</svg>')) {
      svgString = svgString.replace(/<\/svg>\s*$/, watermarkSvg);
    }

    return svgString;
  }

  /**
   * On-Demand Export Path: Rasterizes high-resolution PNG (1000x1000px minimum) with white margin and trimly logo.
   */
  async renderQrCodePng(shortCode: string, config: QrConfigDto): Promise<Buffer> {
    const targetUrl = `${this.shortUrlBase}/${shortCode}`;
    const hasLogoOrText = !!(config.logoUrl || config.centerText);
    const errorCorrectionLevel = hasLogoOrText ? 'H' : 'M';
    const qrSize = BACKEND_QR_RENDER_SIZE;
    const margin = 70;
    const bgColor = config.backgroundColor || '#ffffff';

    const qrCode = new QRCodeStyling({
      jsdom: JSDOM as any,
      nodeCanvas: createCanvas as any,
      type: 'canvas',
      width: qrSize,
      height: qrSize,
      margin,
      data: targetUrl,
      image: config.logoUrl || undefined,
      dotsOptions: {
        color: config.dotsColor || '#000000',
        type: (config.dotsStyle as any) || 'square',
      },
      cornersSquareOptions: {
        type: (config.cornersStyle as any) || 'square',
      },
      cornersDotOptions: {
        type: ((config as any).cornersDotStyle as any) || undefined,
      },
      backgroundOptions: {
        color: bgColor,
      },
      imageOptions: {
        crossOrigin: 'anonymous',
        margin: 10,
        imageSize: 0.3,
      },
      qrOptions: {
        errorCorrectionLevel,
      },
    });

    const raw = await qrCode.getRawData('png');
    if (!raw) {
      throw new Error('Failed to render QR code PNG buffer');
    }

    let rawBuffer: Buffer;
    if (Buffer.isBuffer(raw)) {
      rawBuffer = raw;
    } else if (typeof (raw as any).arrayBuffer === 'function') {
      const ab = await (raw as any).arrayBuffer();
      rawBuffer = Buffer.from(ab);
    } else {
      rawBuffer = Buffer.from(raw as any);
    }

    // Compose final 1000x1000 canvas with margin and 'trimly' watermark logo
    const canvas = createCanvas(qrSize, qrSize);
    const ctx = canvas.getContext('2d');

    // 1. Fill background with configured background color
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, qrSize, qrSize);

    // 2. Draw rendered QR image
    const img = new Image();
    img.src = rawBuffer;
    ctx.drawImage(img, 0, 0, qrSize, qrSize);

    // 3. Draw 'trimly' logo watermark in bottom-right margin
    const isDark = this.isDarkColor(bgColor);
    const textColor = isDark ? '#f8fafc' : '#273144';

    ctx.save();
    ctx.font = 'italic bold 28px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = textColor;
    ctx.globalAlpha = 0.9;
    ctx.fillText('trimly', qrSize - 40, qrSize - 25);
    ctx.restore();

    return canvas.toBuffer('image/png');
  }

  async renderQrCodeBuffer(
    shortCode: string,
    config: QrConfigDto,
    format: 'svg' | 'png' = 'svg',
  ): Promise<Buffer> {
    if (format === 'png') {
      return this.renderQrCodePng(shortCode, config);
    }
    const svg = await this.renderQrCodeSvg(shortCode, config);
    return Buffer.from(svg, 'utf-8');
  }

  async createQrCode(createQrCodeDto: CreateQrCodeDto, userId: string): Promise<{ qrCode: any; imageBase64: string; svg: string }> {
    const { shortCode: inputShortCode, longUrl, title, tags, createLink, qrConfig } = createQrCodeDto;

    let session: ClientSession | null = null;
    try {
      session = await this.connection.startSession();
      session.startTransaction();
    } catch {
      session = null;
    }

    try {
      let targetShortCode = inputShortCode;
      let urlDoc: UrlDocument | null = null;

      if (targetShortCode) {
        const query = this.urlModel.findOne({ shortCode: targetShortCode });
        if (session) query.session(session);
        urlDoc = await query.exec();

        if (urlDoc) {
          if (urlDoc.userId && urlDoc.userId.toString() !== userId) {
            throw new ForbiddenException('You do not have permission to attach a QR code to this link');
          }
          if (longUrl && urlDoc.longUrl !== longUrl) {
            urlDoc.longUrl = longUrl;
            try {
              await this.redis.del(`url:${targetShortCode}`);
            } catch (err: any) {}
          }
          if (title !== undefined) {
            urlDoc.title = title || null;
          }
          if (tags !== undefined) {
            urlDoc.tags = tags || [];
          }
        }
      }

      // If no existing Url document, create it via UrlService (the one path for all link creation)
      if (!urlDoc) {
        const createdUrlRes = await this.urlService.createUrl(
          {
            longUrl: longUrl || (targetShortCode ? `${this.baseUrl}/${targetShortCode}` : 'https://trim.ly'),
            customAlias: targetShortCode || undefined,
            title: title || undefined,
            tags: tags || undefined,
          },
          userId,
          {
            visibleAsLink: Boolean(createLink),
            session: session || undefined,
          },
        );
        targetShortCode = createdUrlRes.shortCode;

        const lookupQuery = this.urlModel.findOne({ shortCode: targetShortCode });
        if (session) lookupQuery.session(session);
        urlDoc = await lookupQuery.exec();
      }

      if (!urlDoc || !targetShortCode) {
        throw new Error('Failed to create or resolve backing URL for QR code');
      }

      const userObjectId = Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : null;
      const filter: any = { shortCode: targetShortCode };
      if (userObjectId) {
        filter.$or = [{ userId: userObjectId }, { userId: userId }];
      } else {
        filter.userId = userId;
      }

      const existingQrQuery = this.qrCodeModel.findOne(filter);
      if (session) existingQrQuery.session(session);
      const existingQr = await existingQrQuery.exec();

      let savedQr: QrCodeDocument;
      const configData = {
        dotsStyle: qrConfig.dotsStyle || 'square',
        cornersStyle: qrConfig.cornersStyle || 'square',
        cornersDotStyle: (qrConfig as any).cornersDotStyle || 'square',
        dotsColor: qrConfig.dotsColor || '#000000',
        backgroundColor: qrConfig.backgroundColor || '#ffffff',
        logoUrl: qrConfig.logoUrl || null,
        centerText: qrConfig.centerText || null,
      };

      if (existingQr) {
        existingQr.qrConfig = configData;
        savedQr = session ? await existingQr.save({ session }) : await existingQr.save();
      } else {
        const newQr = new this.qrCodeModel({
          userId: userObjectId || userId,
          shortCode: targetShortCode,
          qrConfig: configData,
        });
        savedQr = session ? await newQr.save({ session }) : await newQr.save();
      }

      // Update the backing Url with hasQR: true and qrCodeId: savedQr._id
      urlDoc.hasQR = true;
      urlDoc.qrCodeId = savedQr._id;
      if (session) {
        await urlDoc.save({ session });
      } else {
        await urlDoc.save();
      }

      if (session) {
        await session.commitTransaction();
      }

      // Invalidate existing Redis cache for this QR code before setting new cache
      try {
        const oldKeys = await this.redis.keys(`qr:${targetShortCode}:*`);
        if (oldKeys.length > 0) {
          await this.redis.del(...oldKeys);
        }
      } catch (err: any) {}

      // Render vector SVG & cache in Redis under qr:{shortCode}:{configHash}
      const svg = await this.renderQrCodeSvg(targetShortCode, savedQr.qrConfig);
      const configHash = this.hashConfig(targetShortCode, savedQr.qrConfig);
      const cacheKey = `qr:${targetShortCode}:${configHash}`;

      try {
        await this.redis.setex(cacheKey, this.CACHE_TTL, svg);
      } catch (err: any) {
        this.logger.warn(`Redis caching failed for QR code ${cacheKey}: ${err.message}`);
      }

      const visibleAsLink = urlDoc.visibleAsLink !== undefined ? urlDoc.visibleAsLink : true;
      const shortUrl = `${this.shortUrlBase}/${targetShortCode}`;
      const backingLongUrl = urlDoc.longUrl;

      return {
        qrCode: {
          _id: savedQr._id,
          id: savedQr._id.toString(),
          userId: savedQr.userId,
          shortCode: savedQr.shortCode,
          qrConfig: savedQr.qrConfig,
          createdAt: savedQr.createdAt,
          isHidden: savedQr.isHidden,
          title: urlDoc.title || null,
          destinationUrl: urlDoc.longUrl,
          tags: urlDoc.tags || [],
          visibleAsLink,
          shortUrl,
          longUrl: backingLongUrl,
          expiresAt: urlDoc.expiresAt || null,
          svg,
          svgUrl: `${this.shortUrlBase}/api/qrcodes/${targetShortCode}`,
        },
        svg,
        imageBase64: Buffer.from(svg, 'utf-8').toString('base64'),
      };
    } catch (error) {
      if (session) {
        await session.abortTransaction();
      }
      throw error;
    } finally {
      if (session) {
        await session.endSession();
      }
    }
  }

  async getUserQrCodes(
    userId: string,
    filterOptions?: {
      qrExpiration?: 'all' | 'expired' | 'expiring' | 'none';
      linkAttachment?: 'all' | 'with' | 'without';
    },
  ): Promise<any[]> {
    const userObjectId = Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : null;
    const filter: any = {};
    if (userObjectId) {
      filter.$or = [{ userId: userObjectId }, { userId: userId }];
    } else {
      filter.userId = userId;
    }

    const qrCodes = await this.qrCodeModel.find(filter).sort({ createdAt: -1 }).exec();
    const shortCodes = qrCodes.map((qr) => qr.shortCode);

    const urls = await this.urlModel.find({ shortCode: { $in: shortCodes } }).exec();
    const urlMap = new Map(urls.map((u) => [u.shortCode, u]));

    const now = Date.now();
    const expiringThreshold = now + EXPIRING_DAYS_THRESHOLD * 24 * 60 * 60 * 1000;

    const mapped = await Promise.all(
      qrCodes.map(async (qr) => {
        const urlDoc = urlMap.get(qr.shortCode);
        const visibleAsLink = urlDoc?.visibleAsLink !== undefined ? urlDoc.visibleAsLink : true;
        const shortUrl = `${this.shortUrlBase}/${qr.shortCode}`;
        const longUrl = urlDoc?.longUrl || null;
        let svg = '';
        try {
          svg = await this.renderQrCodeSvg(qr.shortCode, qr.qrConfig);
        } catch {
          svg = '';
        }

        return {
          _id: qr._id,
          id: qr._id.toString(),
          userId: qr.userId,
          shortCode: qr.shortCode,
          qrConfig: qr.qrConfig,
          createdAt: qr.createdAt,
          isHidden: qr.isHidden,
          title: urlDoc?.title || null,
          destinationUrl: urlDoc?.longUrl || null,
          tags: urlDoc?.tags || [],
          visibleAsLink,
          shortUrl,
          longUrl,
          expiresAt: urlDoc?.expiresAt || null,
          svg,
          svgUrl: `${this.shortUrlBase}/api/qrcodes/${qr.shortCode}`,
        };
      }),
    );

    return mapped.filter((item) => {
      // 1. Link Attachment Filter (with / without / all)
      if (filterOptions?.linkAttachment === 'with' && !item.visibleAsLink) return false;
      if (filterOptions?.linkAttachment === 'without' && item.visibleAsLink) return false;

      // 2. QR Expiration Filter (expired / expiring / none / all)
      if (filterOptions?.qrExpiration === 'expired') {
        if (!item.expiresAt || new Date(item.expiresAt).getTime() > now) return false;
      } else if (filterOptions?.qrExpiration === 'expiring') {
        if (
          !item.expiresAt ||
          new Date(item.expiresAt).getTime() <= now ||
          new Date(item.expiresAt).getTime() > expiringThreshold
        ) {
          return false;
        }
      } else if (filterOptions?.qrExpiration === 'none') {
        if (item.expiresAt) return false;
      }

      return true;
    });
  }

  async getQrCodeImage(
    shortCode: string,
    userId: string,
    format: 'svg' | 'png' = 'svg',
  ): Promise<{ buffer: Buffer; fromCache: boolean; contentType: string }> {
    if (!userId) throw new ForbiddenException('User ID required');
    const filter = Types.ObjectId.isValid(userId)
      ? { shortCode, $or: [{ userId: new Types.ObjectId(userId) }, { userId: userId }] }
      : { shortCode, userId: userId };

    const qrDoc = await this.qrCodeModel.findOne(filter).exec();
    let configToUse: QrConfigDto;

    if (!qrDoc) {
      // Fallback check: if user owns URL but hasn't saved explicit QR config, use default config
      const urlDoc = await this.urlModel.findOne({ shortCode }).exec();
      if (!urlDoc) {
        throw new NotFoundException('Short URL not found');
      }
      if (!urlDoc.userId || urlDoc.userId.toString() !== userId) {
        throw new ForbiddenException('You do not own this short URL');
      }

      configToUse = {
        dotsStyle: 'square',
        cornersStyle: 'square',
        cornersDotStyle: 'square',
        dotsColor: '#000000',
        backgroundColor: '#ffffff',
        logoUrl: null,
        centerText: null,
      };
    } else {
      configToUse = qrDoc.qrConfig;
    }

    const configHash = this.hashConfig(shortCode, configToUse);
    const cacheKey = format === 'svg' ? `qr:${shortCode}:${configHash}` : `qr:${shortCode}:${configHash}:png`;

    // Redis check first
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        const buffer = format === 'svg' ? Buffer.from(cached, 'utf-8') : Buffer.from(cached, 'base64');
        return {
          buffer,
          fromCache: true,
          contentType: format === 'svg' ? 'image/svg+xml' : 'image/png',
        };
      }
    } catch (err: any) {
      this.logger.warn(`Redis lookup failed for ${cacheKey}: ${err.message}`);
    }

    if (format === 'svg') {
      const svgString = await this.renderQrCodeSvg(shortCode, configToUse);
      try {
        await this.redis.setex(cacheKey, this.CACHE_TTL, svgString);
      } catch (err: any) {
        this.logger.warn(`Redis setex failed for ${cacheKey}: ${err.message}`);
      }
      return {
        buffer: Buffer.from(svgString, 'utf-8'),
        fromCache: false,
        contentType: 'image/svg+xml',
      };
    } else {
      const pngBuffer = await this.renderQrCodePng(shortCode, configToUse);
      try {
        await this.redis.setex(cacheKey, this.CACHE_TTL, pngBuffer.toString('base64'));
      } catch (err: any) {
        this.logger.warn(`Redis setex failed for ${cacheKey}: ${err.message}`);
      }
      return {
        buffer: pngBuffer,
        fromCache: false,
        contentType: 'image/png',
      };
    }
  }

  async deleteQrCode(shortCode: string, userId: string): Promise<{ message: string }> {
    if (!userId) throw new ForbiddenException('User ID required');
    const filter = Types.ObjectId.isValid(userId)
      ? { shortCode, $or: [{ userId: new Types.ObjectId(userId) }, { userId: userId }] }
      : { shortCode, userId: userId };

    const qrDoc = await this.qrCodeModel.findOne(filter).exec();

    if (!qrDoc) {
      throw new NotFoundException('QR Code not found');
    }

    // Update the linked Url: set hasQR: false, qrCodeId: null. Do NOT touch visibleAsLink!
    await this.urlModel.updateOne(
      { shortCode },
      { $set: { hasQR: false, qrCodeId: null } },
    ).exec();

    await this.qrCodeModel.deleteOne({ _id: qrDoc._id }).exec();

    // Invalidate Redis QR cache
    try {
      const qrKeys = await this.redis.keys(`qr:${shortCode}:*`);
      if (qrKeys.length > 0) {
        await this.redis.del(...qrKeys);
      }
    } catch (err: any) {}

    return { message: 'QR Code successfully deleted' };
  }

  async updateQrCode(shortCode: string, updateDto: any, userId: string): Promise<QrCodeDocument> {
    if (!userId) throw new ForbiddenException('User ID required');
    const filter = Types.ObjectId.isValid(userId)
      ? { shortCode, $or: [{ userId: new Types.ObjectId(userId) }, { userId: userId }] }
      : { shortCode, userId: userId };

    const qrDoc = await this.qrCodeModel.findOne(filter).exec();
    
    if (!qrDoc) {
      throw new NotFoundException('QR Code not found');
    }

    if (updateDto.isHidden !== undefined) {
      qrDoc.isHidden = updateDto.isHidden;
    }

    const saved = await qrDoc.save();

    // Invalidate Redis cache on update
    try {
      const qrKeys = await this.redis.keys(`qr:${shortCode}:*`);
      if (qrKeys.length > 0) {
        await this.redis.del(...qrKeys);
      }
    } catch (err: any) {}

    return saved;
  }

  async duplicateQrCode(
    sourceShortCode: string,
    targetShortCode: string,
    userId: string,
  ): Promise<{ qrCode: QrCodeDocument; imageBase64: string; svg: string }> {
    const userObjectId = Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : null;
    const filter: any = { shortCode: sourceShortCode };
    if (userObjectId) {
      filter.$or = [{ userId: userObjectId }, { userId: userId }];
    } else {
      filter.userId = userId;
    }

    const sourceQr = await this.qrCodeModel.findOne(filter).exec();
    if (!sourceQr) {
      throw new NotFoundException('Source QR Code not found');
    }

    const targetUrl = await this.urlModel.findOne({ shortCode: targetShortCode }).exec();
    if (!targetUrl) {
      throw new NotFoundException('Target short URL not found');
    }
    if (targetUrl.userId && targetUrl.userId.toString() !== userId) {
      throw new ForbiddenException('You do not have permission to attach a QR code to this target link');
    }

    const duplicateDto: CreateQrCodeDto = {
      shortCode: targetShortCode,
      qrConfig: {
        dotsStyle: sourceQr.qrConfig.dotsStyle,
        cornersStyle: sourceQr.qrConfig.cornersStyle,
        dotsColor: sourceQr.qrConfig.dotsColor,
        backgroundColor: sourceQr.qrConfig.backgroundColor,
        logoUrl: sourceQr.qrConfig.logoUrl,
        centerText: sourceQr.qrConfig.centerText,
      },
    };

    const res = await this.createQrCode(duplicateDto, userId);
    return {
      qrCode: res.qrCode,
      imageBase64: res.imageBase64,
      svg: res.svg,
    };
  }

  async getQrCodeByCode(shortCode: string, userId: string): Promise<any> {
    if (!userId) throw new ForbiddenException('User ID required');
    const filter = Types.ObjectId.isValid(userId)
      ? { shortCode, $or: [{ userId: new Types.ObjectId(userId) }, { userId: userId }] }
      : { shortCode, userId: userId };

    const qr = await this.qrCodeModel.findOne(filter).exec();
    if (!qr) {
      throw new NotFoundException('QR Code not found');
    }

    const urlDoc = await this.urlModel.findOne({ shortCode }).exec();
    const visibleAsLink = urlDoc?.visibleAsLink !== undefined ? urlDoc.visibleAsLink : true;
    const shortUrl = `${this.shortUrlBase}/${qr.shortCode}`;
    const longUrl = urlDoc?.longUrl || null;
    const destinationUrl = urlDoc?.longUrl || null;
    const svg = await this.renderQrCodeSvg(qr.shortCode, qr.qrConfig);

    return {
      _id: qr._id,
      id: qr._id.toString(),
      userId: qr.userId,
      shortCode: qr.shortCode,
      qrConfig: qr.qrConfig,
      createdAt: qr.createdAt,
      isHidden: qr.isHidden,
      title: urlDoc?.title || null,
      destinationUrl,
      tags: urlDoc?.tags || [],
      visibleAsLink,
      shortUrl,
      longUrl,
      expiresAt: urlDoc?.expiresAt || null,
      svg,
      svgUrl: `${this.shortUrlBase}/api/qrcodes/${qr.shortCode}`,
    };
  }
}
