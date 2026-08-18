import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Click, ClickDocument } from './schemas/click.schema';
import { Url, UrlDocument } from '../url/schemas/url.schema';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectModel(Click.name) private readonly clickModel: Model<ClickDocument>,
    @InjectModel(Url.name) private readonly urlModel: Model<UrlDocument>,
  ) {}

  async getUserOverallAnalytics(userId: string, from?: string, to?: string) {
    const userUrls = await this.urlModel.find({ userId }).select('shortCode longUrl clickCount createdAt title').exec();
    const shortCodes = userUrls.map((u) => u.shortCode);

    const matchQuery: any = { shortCode: { $in: shortCodes } };

    if (from || to) {
      matchQuery.timestamp = {};
      if (from) {
        matchQuery.timestamp.$gte = new Date(from);
      }
      if (to) {
        matchQuery.timestamp.$lte = new Date(to);
      }
    }

    const totalClicksAcrossUserUrls = userUrls.reduce((acc, curr) => acc + (curr.clickCount || 0), 0);
    const filteredTotalClicks = shortCodes.length > 0 ? await this.clickModel.countDocuments(matchQuery) : 0;

    // 1. Clicks by date
    const byDate = shortCodes.length > 0 ? await this.clickModel.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      { $project: { date: '$_id', count: 1, _id: 0 } },
    ]) : [];

    // 2. Clicks by referrer
    const byReferrer = shortCodes.length > 0 ? await this.clickModel.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: { $ifNull: ['$referrer', 'Direct / None'] },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $project: { name: '$_id', count: 1, _id: 0 } },
    ]) : [];

    // 3. Clicks by device type
    const byDevice = shortCodes.length > 0 ? await this.clickModel.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: { $ifNull: ['$deviceType', 'Desktop'] },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $project: { name: '$_id', count: 1, _id: 0 } },
    ]) : [];

    // 4. Clicks by browser
    const byBrowser = shortCodes.length > 0 ? await this.clickModel.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: { $ifNull: ['$browser', 'Unknown'] },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $project: { name: '$_id', count: 1, _id: 0 } },
    ]) : [];

    // 5. Clicks by country
    const byCountry = shortCodes.length > 0 ? await this.clickModel.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: { $ifNull: ['$country', 'Unknown'] },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $project: { name: '$_id', count: 1, _id: 0 } },
    ]) : [];

    // Find top day
    const topDay = byDate.length > 0
      ? [...byDate].sort((a, b) => b.count - a.count)[0]
      : null;

    // Find top country
    const topCountry = byCountry.length > 0 && byCountry[0].name !== 'Unknown'
      ? byCountry[0]
      : (byCountry.length > 1 ? byCountry[1] : null);

    return {
      totalLinks: userUrls.length,
      totalClicks: (from || to) ? filteredTotalClicks : totalClicksAcrossUserUrls,
      allTimeClicks: totalClicksAcrossUserUrls,
      clicksByDate: byDate,
      byDate,
      referrers: byReferrer,
      byReferrer,
      devices: byDevice,
      browsers: byBrowser,
      countries: byCountry,
      topDay,
      topCountry,
      userUrls,
    };
  }

  async getAnalytics(shortCode: string, from?: string, to?: string) {
    const urlDoc = await this.urlModel.findOne({ shortCode }).exec();
    if (!urlDoc) {
      throw new NotFoundException('Short URL not found');
    }

    const matchQuery: any = { shortCode };

    if (from || to) {
      matchQuery.timestamp = {};
      if (from) {
        matchQuery.timestamp.$gte = new Date(from);
      }
      if (to) {
        matchQuery.timestamp.$lte = new Date(to);
      }
    }

    // 1. Total filtered clicks count
    const filteredTotalClicks = await this.clickModel.countDocuments(matchQuery);

    // 2. Clicks by date
    const byDate = await this.clickModel.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      { $project: { date: '$_id', count: 1, _id: 0 } },
    ]);

    // 3. Clicks by referrer
    const byReferrer = await this.clickModel.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: { $ifNull: ['$referrer', 'Direct / None'] },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $project: { name: '$_id', count: 1, _id: 0 } },
    ]);

    // 4. Clicks by device type
    const byDevice = await this.clickModel.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: { $ifNull: ['$deviceType', 'Desktop'] },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $project: { name: '$_id', count: 1, _id: 0 } },
    ]);

    // 5. Clicks by browser
    const byBrowser = await this.clickModel.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: { $ifNull: ['$browser', 'Unknown'] },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $project: { name: '$_id', count: 1, _id: 0 } },
    ]);

    // 6. Clicks by country
    const byCountry = await this.clickModel.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: { $ifNull: ['$country', 'Unknown'] },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $project: { name: '$_id', count: 1, _id: 0 } },
    ]);

    // Find top day
    const topDay = byDate.length > 0
      ? [...byDate].sort((a, b) => b.count - a.count)[0]
      : null;

    // Find top country
    const topCountry = byCountry.length > 0 && byCountry[0].name !== 'Unknown'
      ? byCountry[0]
      : (byCountry.length > 1 ? byCountry[1] : null);

    return {
      shortCode,
      longUrl: urlDoc.longUrl,
      totalClicks: (from || to) ? filteredTotalClicks : urlDoc.clickCount,
      allTimeClicks: urlDoc.clickCount,
      createdAt: (urlDoc as any).createdAt || null,
      clicksByDate: byDate,
      byDate, // backward compatibility
      referrers: byReferrer,
      byReferrer, // backward compatibility
      devices: byDevice,
      browsers: byBrowser,
      countries: byCountry,
      topDay,
      topCountry,
    };
  }
}
