import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { Click } from './schemas/click.schema';
import { Url } from '../url/schemas/url.schema';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let clickModelMock: any;
  let urlModelMock: any;

  beforeEach(async () => {
    clickModelMock = {
      aggregate: jest.fn(),
      countDocuments: jest.fn().mockResolvedValue(15),
    };
    urlModelMock = {
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: getModelToken(Click.name), useValue: clickModelMock },
        { provide: getModelToken(Url.name), useValue: urlModelMock },
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

    clickModelMock.aggregate
      .mockResolvedValueOnce([{ date: '2026-07-29', count: 15 }]) // byDate
      .mockResolvedValueOnce([{ name: 'Direct / None', count: 15 }]) // byReferrer
      .mockResolvedValueOnce([{ name: 'Desktop', count: 12 }, { name: 'Mobile', count: 3 }]) // byDevice
      .mockResolvedValueOnce([{ name: 'Chrome', count: 10 }]) // byBrowser
      .mockResolvedValueOnce([{ name: 'IN', count: 10 }, { name: 'US', count: 5 }]); // byCountry

    const analytics = await service.getAnalytics('code1');

    expect(analytics.shortCode).toBe('code1');
    expect(analytics.totalClicks).toBe(15);
    expect(analytics.clicksByDate).toHaveLength(1);
    expect(analytics.referrers).toHaveLength(1);
    expect(analytics.devices).toHaveLength(2);
    expect(analytics.browsers).toHaveLength(1);
    expect(analytics.countries).toHaveLength(2);
  });

  it('should filter analytics by date range when from/to params are provided', async () => {
    urlModelMock.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        shortCode: 'code1',
        longUrl: 'https://example.com',
        clickCount: 100,
      }),
    });

    clickModelMock.countDocuments.mockResolvedValue(5);
    clickModelMock.aggregate
      .mockResolvedValueOnce([{ date: '2026-08-01', count: 5 }])
      .mockResolvedValueOnce([{ name: 'google.com', count: 5 }])
      .mockResolvedValueOnce([{ name: 'Mobile', count: 5 }])
      .mockResolvedValueOnce([{ name: 'Safari', count: 5 }])
      .mockResolvedValueOnce([{ name: 'IN', count: 5 }]);

    const analytics = await service.getAnalytics('code1', '2026-08-01', '2026-08-07');

    expect(analytics.totalClicks).toBe(5);
    expect(clickModelMock.countDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        shortCode: 'code1',
        timestamp: {
          $gte: expect.any(Date),
          $lte: expect.any(Date),
        },
      }),
    );
  });

  it('should throw NotFoundException if shortCode is invalid', async () => {
    urlModelMock.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });

    await expect(service.getAnalytics('nonexistent')).rejects.toThrow(NotFoundException);
  });
});
