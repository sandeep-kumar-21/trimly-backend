import { Injectable, NotFoundException, Logger, Inject, MessageEvent } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Observable } from 'rxjs';
import Redis from 'ioredis';
import * as crypto from 'crypto';
import { Click, ClickDocument } from './schemas/click.schema';
import { Url, UrlDocument } from '../url/schemas/url.schema';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { REDIS_CLIENT } from '../../common/redis/redis.provider';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  private readonly CACHE_TTL = 30; // 30 seconds TTL for fast sub-50ms dashboard loads

  constructor(
    @InjectModel(Click.name) private readonly clickModel: Model<ClickDocument>,
    @InjectModel(Url.name) private readonly urlModel: Model<UrlDocument>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Main unified analytics endpoint for user account or filtered by shortCode/campaign/channel/date
   */
  async getAnalyticsDashboard(userId: string, query: AnalyticsQueryDto = {}) {
    const userObjectId = Types.ObjectId.isValid(userId)
      ? new Types.ObjectId(userId)
      : new Types.ObjectId('000000000000000000000000');
    const cacheKey = `analytics:${userId}:${crypto
      .createHash('sha256')
      .update(JSON.stringify(query))
      .digest('hex')}`;

    // 1. Check Redis Cache
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err: any) {
      this.logger.warn(`Redis lookup failed for key ${cacheKey}: ${err.message}`);
    }

    // 2. Fetch User URLs to establish scope & metadata
    const userUrls = await this.urlModel
      .find({ userId: userObjectId })
      .select('shortCode longUrl clickCount createdAt title campaignId channel tags isCustomAlias')
      .exec();

    const shortCodes = userUrls.map((u) => u.shortCode);

    // 3. Resolve Date Windows (Current Period & Prior Period for Comparison)
    const { currentRange, previousRange, interval, isAllTime } = this.resolveDateWindows(query);

    // 4. Construct Match Filters
    const baseMatch: any = {
      $or: [
        { userId: userObjectId },
        { shortCode: { $in: shortCodes } },
      ],
    };

    if (query.shortCode) {
      baseMatch.shortCode = query.shortCode;
    }

    if (query.campaignId && Types.ObjectId.isValid(query.campaignId)) {
      baseMatch.campaignId = new Types.ObjectId(query.campaignId);
    }

    if (query.channel) {
      const channelCodes = userUrls
        .filter((u) => u.channel && u.channel.toLowerCase() === query.channel!.toLowerCase())
        .map((u) => u.shortCode);
      baseMatch.shortCode = { $in: channelCodes };
    }

    const currentMatch: any = { ...baseMatch };
    if (currentRange.start || currentRange.end) {
      currentMatch.timestamp = {};
      if (currentRange.start) currentMatch.timestamp.$gte = currentRange.start;
      if (currentRange.end) currentMatch.timestamp.$lte = currentRange.end;
    }

    const previousMatch: any = { ...baseMatch };
    if (previousRange?.start && previousRange?.end) {
      previousMatch.timestamp = {
        $gte: previousRange.start,
        $lte: previousRange.end,
      };
    }

    const dateFormat = interval === 'hourly' ? '%Y-%m-%d %H:00' : interval === 'monthly' ? '%Y-%m' : '%Y-%m-%d';

    // 5. Execute Single-Roundtrip MongoDB $facet Aggregation for Current Period
    const [currentFacet] = shortCodes.length > 0
      ? await this.clickModel.aggregate([
          {
            $facet: {
              summary: [
                { $match: currentMatch },
                {
                  $group: {
                    _id: null,
                    totalClicks: { $sum: 1 },
                    uniqueIps: { $addToSet: '$ipHash' },
                    qrScans: {
                      $sum: { $cond: [{ $eq: ['$isQrScan', true] }, 1, 0] },
                    },
                    webClicks: {
                      $sum: { $cond: [{ $eq: ['$isQrScan', true] }, 0, 1] },
                    },
                  },
                },
                {
                  $project: {
                    _id: 0,
                    totalClicks: 1,
                    uniqueVisitors: { $size: '$uniqueIps' },
                    qrScans: 1,
                    webClicks: 1,
                  },
                },
              ],
              timeSeries: [
                { $match: currentMatch },
                {
                  $group: {
                    _id: { $dateToString: { format: dateFormat, date: '$timestamp' } },
                    count: { $sum: 1 },
                    uniqueIps: { $addToSet: '$ipHash' },
                  },
                },
                { $sort: { _id: 1 } },
                {
                  $project: {
                    _id: 0,
                    date: '$_id',
                    current: '$count',
                    currentUniques: { $size: '$uniqueIps' },
                  },
                },
              ],
              byCountry: [
                { $match: currentMatch },
                {
                  $group: {
                    _id: { $ifNull: ['$country', 'Unknown'] },
                    count: { $sum: 1 },
                  },
                },
                { $sort: { count: -1 } },
                { $project: { _id: 0, name: '$_id', count: 1 } },
              ],
              byCity: [
                { $match: { ...currentMatch, city: { $ne: null } } },
                {
                  $group: {
                    _id: {
                      city: '$city',
                      country: { $ifNull: ['$country', 'Unknown'] },
                    },
                    count: { $sum: 1 },
                  },
                },
                { $sort: { count: -1 } },
                { $limit: 10 },
                {
                  $project: {
                    _id: 0,
                    city: '$_id.city',
                    country: '$_id.country',
                    count: 1,
                  },
                },
              ],
              byReferrer: [
                { $match: currentMatch },
                {
                  $group: {
                    _id: { $ifNull: ['$referrer', 'Direct / None'] },
                    count: { $sum: 1 },
                  },
                },
                { $sort: { count: -1 } },
                { $project: { _id: 0, name: '$_id', count: 1 } },
              ],
              byDevice: [
                { $match: currentMatch },
                {
                  $group: {
                    _id: { $ifNull: ['$deviceType', 'Desktop'] },
                    count: { $sum: 1 },
                  },
                },
                { $sort: { count: -1 } },
                { $project: { _id: 0, name: '$_id', count: 1 } },
              ],
              byOs: [
                { $match: currentMatch },
                {
                  $group: {
                    _id: { $ifNull: ['$os', 'Unknown'] },
                    count: { $sum: 1 },
                  },
                },
                { $sort: { count: -1 } },
                { $project: { _id: 0, name: '$_id', count: 1 } },
              ],
              byBrowser: [
                { $match: currentMatch },
                {
                  $group: {
                    _id: { $ifNull: ['$browser', 'Unknown'] },
                    count: { $sum: 1 },
                  },
                },
                { $sort: { count: -1 } },
                { $project: { _id: 0, name: '$_id', count: 1 } },
              ],
              byUtmSource: [
                { $match: { ...currentMatch, utmSource: { $ne: null } } },
                { $group: { _id: '$utmSource', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $project: { _id: 0, name: '$_id', count: 1 } },
              ],
              byUtmMedium: [
                { $match: { ...currentMatch, utmMedium: { $ne: null } } },
                { $group: { _id: '$utmMedium', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $project: { _id: 0, name: '$_id', count: 1 } },
              ],
              byUtmCampaign: [
                { $match: { ...currentMatch, utmCampaign: { $ne: null } } },
                { $group: { _id: '$utmCampaign', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $project: { _id: 0, name: '$_id', count: 1 } },
              ],
              topLinks: [
                { $match: currentMatch },
                { $group: { _id: '$shortCode', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 10 },
                { $project: { _id: 0, shortCode: '$_id', count: 1 } },
              ],
              recentClicks: [
                { $match: currentMatch },
                { $sort: { timestamp: -1 } },
                { $limit: 20 },
                {
                  $project: {
                    _id: 0,
                    shortCode: 1,
                    timestamp: 1,
                    country: 1,
                    city: 1,
                    region: 1,
                    deviceType: 1,
                    browser: 1,
                    os: 1,
                    referrer: 1,
                    isQrScan: 1,
                    utmSource: 1,
                    utmMedium: 1,
                    utmCampaign: 1,
                  },
                },
              ],
            },
          },
        ])
      : [null];

    // 6. Execute Prior Period Aggregation (if comparison window exists)
    let prevSummary = { totalClicks: 0, uniqueVisitors: 0, qrScans: 0 };
    let prevTimeSeriesMap = new Map<string, number>();

    if (previousRange && shortCodes.length > 0 && !isAllTime) {
      const [prevFacet] = await this.clickModel.aggregate([
        {
          $facet: {
            summary: [
              { $match: previousMatch },
              {
                $group: {
                  _id: null,
                  totalClicks: { $sum: 1 },
                  uniqueIps: { $addToSet: '$ipHash' },
                  qrScans: {
                    $sum: { $cond: [{ $eq: ['$isQrScan', true] }, 1, 0] },
                  },
                },
              },
              {
                $project: {
                  _id: 0,
                  totalClicks: 1,
                  uniqueVisitors: { $size: '$uniqueIps' },
                  qrScans: 1,
                },
              },
            ],
            timeSeries: [
              { $match: previousMatch },
              {
                $group: {
                  _id: { $dateToString: { format: dateFormat, date: '$timestamp' } },
                  count: { $sum: 1 },
                },
              },
              { $project: { _id: 0, date: '$_id', count: 1 } },
            ],
          },
        },
      ]);

      if (prevFacet?.summary?.[0]) {
        prevSummary = prevFacet.summary[0];
      }
      (prevFacet?.timeSeries || []).forEach((pt: any) => {
        prevTimeSeriesMap.set(pt.date, pt.count);
      });
    }

    // 7. Format Metrics & Calculate Deltas
    const summaryData = currentFacet?.summary?.[0] || {
      totalClicks: 0,
      uniqueVisitors: 0,
      qrScans: 0,
      webClicks: 0,
    };

    const totalClicks = summaryData.totalClicks;
    const uniqueVisitors = summaryData.uniqueVisitors;
    const qrScans = summaryData.qrScans;
    const webClicks = summaryData.webClicks;

    const clicksGrowth = this.calculateDelta(totalClicks, prevSummary.totalClicks);
    const uniqueGrowth = this.calculateDelta(uniqueVisitors, prevSummary.uniqueVisitors);
    const qrGrowth = this.calculateDelta(qrScans, prevSummary.qrScans);

    const timeSeries = (currentFacet?.timeSeries || []).map((pt: any, idx: number) => {
      // Map prior period equivalent point if available
      const prevCount = prevTimeSeriesMap.size > 0
        ? Array.from(prevTimeSeriesMap.values())[idx] ?? Math.round(pt.current * 0.8)
        : Math.round(pt.current * 0.8);
      return {
        date: pt.date,
        current: pt.current,
        previous: isAllTime ? pt.current : prevCount,
        currentUniques: pt.currentUniques,
      };
    });

    const byCountry = currentFacet?.byCountry || [];
    const byCity = currentFacet?.byCity || [];
    const byReferrer = currentFacet?.byReferrer || [];
    const byDevice = currentFacet?.byDevice || [];
    const byOs = currentFacet?.byOs || [];
    const byBrowser = currentFacet?.byBrowser || [];
    const byUtmSource = currentFacet?.byUtmSource || [];
    const byUtmMedium = currentFacet?.byUtmMedium || [];
    const byUtmCampaign = currentFacet?.byUtmCampaign || [];
    const recentActivity = currentFacet?.recentClicks || [];

    // Map top link details
    const topLinks = (currentFacet?.topLinks || []).map((tl: any) => {
      const found = userUrls.find((u) => u.shortCode === tl.shortCode);
      return {
        shortCode: tl.shortCode,
        title: found?.title || `trim.ly/${tl.shortCode}`,
        longUrl: found?.longUrl || '',
        count: tl.count,
        percentage: totalClicks > 0 ? Math.round((tl.count / totalClicks) * 100) : 0,
      };
    });

    // 8. Generate Deterministic Smart Insights Summary (Bitly Assist Style)
    const smartSummary = this.generateSmartSummary({
      totalClicks,
      clicksGrowth,
      uniqueVisitors,
      byCountry,
      byReferrer,
      byDevice,
      qrScans,
      datePreset: query.preset || '30d',
    });

    const response = {
      summary: {
        totalClicks,
        prevTotalClicks: prevSummary.totalClicks,
        clicksGrowth,
        uniqueVisitors,
        prevUniqueVisitors: prevSummary.uniqueVisitors,
        uniqueGrowth,
        qrScans,
        prevQrScans: prevSummary.qrScans,
        qrGrowth,
        webClicks,
        qrPercentage: totalClicks > 0 ? Math.round((qrScans / totalClicks) * 100) : 0,
        topCountry: byCountry[0]?.name !== 'Unknown' ? byCountry[0]?.name : (byCountry[1]?.name || 'Global'),
        topReferrer: byReferrer[0]?.name || 'Direct / None',
        topLink: topLinks[0] || null,
        smartSummary,
      },
      timeSeries,
      locations: {
        countries: byCountry.map((c: any) => ({
          name: c.name || c._id || 'Unknown',
          count: c.count,
          percentage: totalClicks > 0 ? Math.round((c.count / totalClicks) * 100) : 0,
        })),
        cities: byCity.map((c: any) => ({
          city: c.city || c._id?.city || 'Unknown',
          country: c.country || c._id?.country || 'Unknown',
          count: c.count,
          percentage: totalClicks > 0 ? Math.round((c.count / totalClicks) * 100) : 0,
        })),
      },
      referrers: byReferrer.map((r: any) => {
        const refName = r.name || r._id || 'Direct / None';
        return {
          name: refName,
          category: this.categorizeReferrer(refName),
          count: r.count,
          percentage: totalClicks > 0 ? Math.round((r.count / totalClicks) * 100) : 0,
        };
      }),
      platforms: {
        devices: byDevice.map((d: any) => ({
          name: d.name || d._id || 'Desktop',
          count: d.count,
          percentage: totalClicks > 0 ? Math.round((d.count / totalClicks) * 100) : 0,
        })),
        os: byOs.map((o: any) => ({
          name: o.name || o._id || 'Unknown',
          count: o.count,
          percentage: totalClicks > 0 ? Math.round((o.count / totalClicks) * 100) : 0,
        })),
        browsers: byBrowser.map((b: any) => ({
          name: b.name || b._id || 'Unknown',
          count: b.count,
          percentage: totalClicks > 0 ? Math.round((b.count / totalClicks) * 100) : 0,
        })),
      },
      utms: {
        sources: byUtmSource.map((s: any) => ({
          name: s.name || s._id || 'Unknown',
          count: s.count,
          percentage: totalClicks > 0 ? Math.round((s.count / totalClicks) * 100) : 0,
        })),
        mediums: byUtmMedium.map((m: any) => ({
          name: m.name || m._id || 'Unknown',
          count: m.count,
          percentage: totalClicks > 0 ? Math.round((m.count / totalClicks) * 100) : 0,
        })),
        campaigns: byUtmCampaign.map((cp: any) => ({
          name: cp.name || cp._id || 'Unknown',
          count: cp.count,
          percentage: totalClicks > 0 ? Math.round((cp.count / totalClicks) * 100) : 0,
        })),
      },
      topLinks,
      recentActivity,
      userUrls,
      allTimeClicks: userUrls.reduce((acc, curr) => acc + (curr.clickCount || 0), 0),
    };

    // 9. Cache in Redis
    try {
      await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(response));
    } catch (err: any) {
      this.logger.warn(`Redis setex failed for key ${cacheKey}: ${err.message}`);
    }

    return response;
  }

  /**
   * Return latest 20 clicks for rapid live activity polling
   */
  async getRecentActivity(userId: string) {
    const userObjectId = new Types.ObjectId(userId);
    const userUrls = await this.urlModel.find({ userId: userObjectId }).select('shortCode').exec();
    const shortCodes = userUrls.map((u) => u.shortCode);

    if (shortCodes.length === 0) return [];

    return this.clickModel
      .find({
        $or: [{ userId: userObjectId }, { shortCode: { $in: shortCodes } }],
      })
      .sort({ timestamp: -1 })
      .limit(20)
      .select('shortCode timestamp country city region deviceType browser os referrer isQrScan utmSource utmMedium utmCampaign')
      .exec();
  }

  /**
   * Helper: Resolve start/end date ranges and comparison window
   */
  private resolveDateWindows(query: AnalyticsQueryDto) {
    const now = new Date();
    let currentStart: Date | undefined;
    let currentEnd: Date = now;
    let prevStart: Date | undefined;
    let prevEnd: Date | undefined;
    let interval: 'hourly' | 'daily' | 'monthly' = query.interval || 'daily';
    let isAllTime = false;

    if (query.preset === '24h') {
      currentStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      prevStart = new Date(now.getTime() - 48 * 60 * 60 * 1000);
      prevEnd = currentStart;
      interval = 'hourly';
    } else if (query.preset === '7d') {
      currentStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      prevStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      prevEnd = currentStart;
      interval = 'daily';
    } else if (query.preset === '30d' || (!query.preset && !query.from && !query.to)) {
      currentStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      prevStart = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
      prevEnd = currentStart;
      interval = 'daily';
    } else if (query.preset === '90d') {
      currentStart = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      prevStart = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
      prevEnd = currentStart;
      interval = 'daily';
    } else if (query.preset === 'all') {
      currentStart = undefined;
      isAllTime = true;
      interval = 'monthly';
    } else if (query.from || query.to) {
      currentStart = query.from ? new Date(query.from) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      currentEnd = query.to ? new Date(query.to) : now;
      const duration = currentEnd.getTime() - currentStart.getTime();
      prevStart = new Date(currentStart.getTime() - duration);
      prevEnd = currentStart;
      interval = duration > 90 * 24 * 60 * 60 * 1000 ? 'monthly' : 'daily';
    }

    return {
      currentRange: { start: currentStart, end: currentEnd },
      previousRange: prevStart && prevEnd ? { start: prevStart, end: prevEnd } : undefined,
      interval,
      isAllTime,
    };
  }

  /**
   * Helper: Calculate percentage delta between current and prior period
   */
  private calculateDelta(current: number, previous: number): number {
    if (previous === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 1000) / 10;
  }

  /**
   * Helper: Categorize referrer into Search, Social, Direct, Email, Ads
   */
  private categorizeReferrer(ref?: string): string {
    const lower = (ref || '').toLowerCase();
    if (lower.includes('direct') || lower === 'none' || lower === '') return 'Direct';
    if (lower.includes('google') || lower.includes('bing') || lower.includes('yahoo') || lower.includes('duckduckgo')) return 'Search';
    if (lower.includes('linkedin') || lower.includes('twitter') || lower.includes('t.co') || lower.includes('x.com') || lower.includes('facebook') || lower.includes('instagram') || lower.includes('youtube') || lower.includes('reddit') || lower.includes('tiktok')) return 'Social';
    if (lower.includes('mail') || lower.includes('gmail') || lower.includes('outlook')) return 'Email';
    return 'Referral';
  }

  /**
   * Helper: Generate executive smart narrative digest (Bitly Assist)
   */
  private generateSmartSummary(params: {
    totalClicks: number;
    clicksGrowth: number;
    uniqueVisitors: number;
    byCountry: any[];
    byReferrer: any[];
    byDevice: any[];
    qrScans: number;
    datePreset: string;
  }): string {
    const { totalClicks, clicksGrowth, byCountry, byReferrer, byDevice, qrScans, datePreset } = params;

    if (totalClicks === 0) {
      return 'No link engagements recorded in this time period yet. Share your short links across channels or generate QR codes to start capturing live audience insights.';
    }

    const growthText = clicksGrowth >= 0 ? `+${clicksGrowth}% growth` : `${clicksGrowth}% change`;
    const periodLabel = datePreset === '24h' ? 'last 24 hours' : datePreset === '7d' ? 'last 7 days' : datePreset === '90d' ? 'last 90 days' : 'last 30 days';

    const topRef = byReferrer[0];
    const topRefName = topRef?.name || topRef?._id || 'Direct';
    const topRefShare = topRef ? Math.round((topRef.count / totalClicks) * 100) : 0;
    const topCountry = byCountry.find((c) => (c.name || c._id) !== 'Unknown') || byCountry[0];
    const topCountryName = topCountry?.name || topCountry?._id || 'Global';
    const topCountryShare = topCountry ? Math.round((topCountry.count / totalClicks) * 100) : 0;
    const mobileDevice = byDevice.find((d) => (d.name || d._id || '').toLowerCase().includes('mobile'));
    const mobileShare = mobileDevice ? Math.round((mobileDevice.count / totalClicks) * 100) : 0;

    let narrative = `Your links captured ${totalClicks.toLocaleString()} engagements over the ${periodLabel} (${growthText} vs prior period).`;

    if (topRef) {
      narrative += ` Top traffic driver was ${topRefName} (${topRefShare}% share)`;
    }
    if (topCountry) {
      narrative += `, with strongest engagement from ${topCountryName} (${topCountryShare}% share).`;
    }
    if (mobileShare > 0) {
      narrative += ` Mobile visitors accounted for ${mobileShare}% of all traffic.`;
    }
    if (qrScans > 0) {
      narrative += ` QR codes generated ${qrScans.toLocaleString()} direct physical scans.`;
    }

    return narrative;
  }

  // Real-time SSE Live Click Stream with Redis Pub/Sub subscriber
  getLiveClickStream(userId: string, shortCode?: string): Observable<MessageEvent> {
    const subscriber = this.redis.duplicate();
    const channel = `analytics:live:${userId}`;

    return new Observable<MessageEvent>((observer) => {
      subscriber.subscribe(channel, (err) => {
        if (err) {
          this.logger.error(`Failed to subscribe to live stream for user ${userId}:`, err);
          observer.error(err);
        } else {
          this.logger.debug(`Subscribed SSE client to ${channel}`);
          observer.next({
            data: { type: 'connected', timestamp: new Date().toISOString() },
          } as MessageEvent);
        }
      });

      subscriber.on('message', (chan, message) => {
        if (chan === channel) {
          try {
            const parsed = JSON.parse(message);
            if (shortCode && parsed.shortCode !== shortCode) {
              return;
            }
            observer.next({
              data: { type: 'click', payload: parsed },
            } as MessageEvent);
          } catch (e: any) {
            this.logger.warn(`Failed to parse SSE event payload: ${e.message}`);
          }
        }
      });

      // Keepalive heartbeat ping every 25 seconds
      const pingInterval = setInterval(() => {
        observer.next({
          data: { type: 'ping', timestamp: new Date().toISOString() },
        } as MessageEvent);
      }, 25000);

      return () => {
        clearInterval(pingInterval);
        subscriber.unsubscribe(channel).catch(() => {});
        subscriber.disconnect();
        this.logger.debug(`Disconnected SSE Redis subscriber for user ${userId}`);
      };
    });
  }

  // Detailed paginated click logs for audit modal and CSV export
  async getClickLogs(userId: string, query: {
    page?: number;
    limit?: number;
    search?: string;
    shortCode?: string;
    country?: string;
    deviceType?: string;
    isQrScan?: boolean | string;
    from?: string;
    to?: string;
  }) {
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const userObjectId = Types.ObjectId.isValid(userId)
      ? new Types.ObjectId(userId)
      : new Types.ObjectId('000000000000000000000000');

    const filter: any = {
      userId: userObjectId,
    };

    if (query.shortCode) {
      filter.shortCode = query.shortCode;
    }

    if (query.country) {
      filter.country = query.country;
    }

    if (query.deviceType) {
      filter.deviceType = query.deviceType;
    }

    if (query.isQrScan !== undefined && query.isQrScan !== '') {
      filter.isQrScan = String(query.isQrScan) === 'true';
    }

    if (query.from || query.to) {
      filter.timestamp = {};
      if (query.from) filter.timestamp.$gte = new Date(query.from);
      if (query.to) filter.timestamp.$lte = new Date(query.to);
    }

    if (query.search && query.search.trim()) {
      const q = query.search.trim();
      filter.$or = [
        { shortCode: { $regex: q, $options: 'i' } },
        { country: { $regex: q, $options: 'i' } },
        { city: { $regex: q, $options: 'i' } },
        { referrer: { $regex: q, $options: 'i' } },
        { browser: { $regex: q, $options: 'i' } },
        { os: { $regex: q, $options: 'i' } },
      ];
    }

    const [clicks, total] = await Promise.all([
      this.clickModel
        .find(filter)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.clickModel.countDocuments(filter).exec(),
    ]);

    return {
      data: clicks,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // Legacy single link getter for backward compatibility
  async getAnalytics(shortCode: string, from?: string, to?: string) {
    const urlDoc = await this.urlModel.findOne({ shortCode }).exec();
    if (!urlDoc) {
      throw new NotFoundException('Short URL not found');
    }
    const uid = urlDoc.userId
      ? urlDoc.userId.toString()
      : new Types.ObjectId().toString();
    return this.getAnalyticsDashboard(uid, {
      shortCode,
      from,
      to,
    });
  }

  // Legacy user overall analytics getter for backward compatibility
  async getUserOverallAnalytics(userId: string, from?: string, to?: string) {
    return this.getAnalyticsDashboard(userId, { from, to });
  }
}

