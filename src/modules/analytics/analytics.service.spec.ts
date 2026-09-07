import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { Click } from './schemas/click.schema';
import { Url } from '../url/schemas/url.schema';
import { REDIS_CLIENT } from '../../common/redis/redis.provider';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let clickModelMock: any;
  let urlModelMock: any;
  let redisMock: any;

  beforeEach(async () => {
    const mockFacetResult = {
      summary: [{ totalClicks: 15, uniqueVisitors: 10, qrScans: 3, webClicks: 12 }],
      prevSummary: [{ totalClicks: 10, uniqueVisitors: 8, qrScans: 2, webClicks: 8 }],
      timeSeries: [{ date: '2026-07-29', current: 15, previous: 10, currentUniques: 10 }],
      byCountry: [{ _id: 'IN', count: 10 }, { _id: 'US', count: 5 }],
      byCity: [{ _id: { city: 'Mumbai', country: 'IN' }, count: 10 }],
      byReferrer: [{ _id: 'Direct / None', count: 15 }],
      byDevice: [{ _id: 'Desktop', count: 12 }, { _id: 'Mobile', count: 3 }],
      byOs: [{ _id: 'Windows', count: 12 }],
      byBrowser: [{ _id: 'Chrome', count: 10 }],
      byUtmSource: [{ _id: 'linkedin', count: 10 }],
      byUtmMedium: [{ _id: 'social', count: 10 }],
      byUtmCampaign: [{ _id: 'summer_promo', count: 10 }],
      topLinks: [{ _id: 'code1', count: 15, uniques: 10 }],
      recentClicks: [],
    };

    clickModelMock = {
      aggregate: jest.fn().mockResolvedValue([mockFacetResult]),
      countDocuments: jest.fn().mockResolvedValue(15),
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              lean: jest.fn().mockReturnValue({
                exec: jest.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
      }),
    };

    urlModelMock = {
      findOne: jest.fn(),
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            {
              shortCode: 'code1',
              longUrl: 'https://example.com',
              clickCount: 15,
              title: 'Example',
              campaignId: null,
              channel: null,
              tags: [],
            },
          ]),
        }),
      }),
    };

    redisMock = {
      get: jest.fn().mockResolvedValue(null),
      setex: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
      keys: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: getModelToken(Click.name), useValue: clickModelMock },
        { provide: getModelToken(Url.name), useValue: urlModelMock },
        { provide: REDIS_CLIENT, useValue: redisMock },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
  });

  it('should return aggregated analytics for valid short code', async () => {
    urlModelMock.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        shortCode: 'code1',
        longUrl: 'https://example.com',
        clickCount: 15,
        createdAt: new Date('2026-07-01'),
      }),
    });

    const analytics = await service.getAnalytics('code1');

    expect(analytics.summary.totalClicks).toBe(15);
    expect(analytics.summary.uniqueVisitors).toBe(10);
    expect(analytics.timeSeries).toHaveLength(1);
    expect(analytics.locations.countries).toHaveLength(2);
    expect(analytics.referrers).toHaveLength(1);
    expect(analytics.platforms.devices).toHaveLength(2);
  });

  it('should filter analytics by date range when from/to params are provided', async () => {
    urlModelMock.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        shortCode: 'code1',
        longUrl: 'https://example.com',
        clickCount: 100,
      }),
    });

    const analytics = await service.getAnalytics('code1', '2026-08-01', '2026-08-07');

    expect(analytics.summary.totalClicks).toBe(15);
    expect(clickModelMock.aggregate).toHaveBeenCalled();
  });

  it('should throw NotFoundException if shortCode is invalid', async () => {
    urlModelMock.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });

    await expect(service.getAnalytics('nonexistent')).rejects.toThrow(NotFoundException);
  });
});
