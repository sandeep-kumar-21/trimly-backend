import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { CampaignsService } from './campaigns.service';
import { Campaign } from './schemas/campaign.schema';
import { Url } from '../url/schemas/url.schema';
import { REDIS_CLIENT } from '../../common/redis/redis.provider';

import { UrlService } from '../url/url.service';
import { UrlMetadataQueue } from '../queue/url-metadata.queue';

describe('CampaignsService', () => {
  let service: CampaignsService;
  let campaignModelMock: any;
  let urlModelMock: any;
  let redisMock: any;
  let urlServiceMock: any;
  let urlMetadataQueueMock: any;

  const mockUserId = new Types.ObjectId().toString();
  const mockCampaignId = new Types.ObjectId().toString();

  beforeEach(async () => {
    campaignModelMock = function (dto: any) {
      return {
        ...dto,
        _id: new Types.ObjectId(mockCampaignId),
        save: jest.fn().mockResolvedValue({
          _id: new Types.ObjectId(mockCampaignId),
          name: dto.name,
          description: dto.description || null,
          userId: dto.userId,
          createdAt: new Date(),
        }),
      };
    };

    campaignModelMock.findOne = jest.fn();
    campaignModelMock.find = jest.fn();
    campaignModelMock.deleteOne = jest.fn();

    urlModelMock = {
      aggregate: jest.fn(),
      updateMany: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 2 }) }),
    };

    urlServiceMock = {
      create: jest.fn(),
      shortUrlBase: 'http://localhost:4000',
    };

    urlMetadataQueueMock = {
      addMetadataJob: jest.fn(),
    };

    redisMock = {
      get: jest.fn().mockResolvedValue(null),
      setex: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CampaignsService,
        { provide: getModelToken(Campaign.name), useValue: campaignModelMock },
        { provide: getModelToken(Url.name), useValue: urlModelMock },
        { provide: UrlService, useValue: urlServiceMock },
        { provide: UrlMetadataQueue, useValue: urlMetadataQueueMock },
        { provide: REDIS_CLIENT, useValue: redisMock },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultVal?: string) => {
              if (key === 'SHORT_URL_BASE') return 'http://localhost:4000';
              if (key === 'BASE_URL') return 'http://localhost:4000';
              return defaultVal || 'http://localhost:4000';
            }),
          },
        },
      ],
    }).compile();

    service = module.get<CampaignsService>(CampaignsService);
  });

  it('should create a new campaign for authenticated user', async () => {
    const result = await service.createCampaign({ name: 'Summer Promo' }, mockUserId);
    expect(result.name).toBe('Summer Promo');
    expect(result.id).toBe(mockCampaignId);
  });

  it('should execute aggregation pipeline and group links by channel for campaign details', async () => {
    const mockCampaignDoc = {
      _id: new Types.ObjectId(mockCampaignId),
      name: 'Summer Promo',
      userId: new Types.ObjectId(mockUserId),
      createdAt: new Date(),
    };

    campaignModelMock.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(mockCampaignDoc),
    });

    urlModelMock.aggregate.mockResolvedValue([
      {
        channel: 'email',
        totalClicks: 120,
        totalLinks: 2,
        links: [
          {
            _id: new Types.ObjectId(),
            shortCode: 'email1',
            longUrl: 'https://example.com/email1',
            clickCount: 70,
            channel: 'email',
            createdAt: new Date(),
          },
          {
            _id: new Types.ObjectId(),
            shortCode: 'email2',
            longUrl: 'https://example.com/email2',
            clickCount: 50,
            channel: 'email',
            createdAt: new Date(),
          },
        ],
      },
      {
        channel: 'social',
        totalClicks: 80,
        totalLinks: 1,
        links: [
          {
            _id: new Types.ObjectId(),
            shortCode: 'soc1',
            longUrl: 'https://example.com/social1',
            clickCount: 80,
            channel: 'social',
            createdAt: new Date(),
          },
        ],
      },
    ]);

    const details = await service.getCampaignDetails(mockCampaignId, mockUserId);

    expect(campaignModelMock.findOne).toHaveBeenCalledWith({
      _id: new Types.ObjectId(mockCampaignId),
      userId: new Types.ObjectId(mockUserId),
    });
    expect(urlModelMock.aggregate).toHaveBeenCalled();
    expect(details.campaign.name).toBe('Summer Promo');
    expect(details.totalClicks).toBe(200);
    expect(details.totalLinks).toBe(3);
    expect(details.channels).toHaveLength(4);
    expect(details.channels.filter((c: any) => c.totalLinks > 0)).toHaveLength(2);
    expect(details.channels[0].channel).toBe('email');
    expect(details.channels[0].totalClicks).toBe(120);
    expect(details.channels[0].links[0].shortUrl).toBe('http://localhost:4000/email1');
  });

  it('should throw NotFoundException if campaign does not exist or belong to user', async () => {
    campaignModelMock.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });

    await expect(service.getCampaignDetails(mockCampaignId, mockUserId)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('should throw BadRequestException if campaign ID is invalid', async () => {
    await expect(service.getCampaignDetails('invalid-id', mockUserId)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('should un-link associated Url documents on deleteCampaign', async () => {
    const mockCampaignDoc = {
      _id: new Types.ObjectId(mockCampaignId),
      name: 'To Delete',
      userId: new Types.ObjectId(mockUserId),
    };

    campaignModelMock.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(mockCampaignDoc),
    });
    campaignModelMock.deleteOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    });

    const res = await service.deleteCampaign(mockCampaignId, mockUserId);
    expect(urlModelMock.updateMany).toHaveBeenCalledWith(
      { campaignId: new Types.ObjectId(mockCampaignId), userId: new Types.ObjectId(mockUserId) },
      { $set: { campaignId: null, channel: null } },
    );
    expect(res.message).toContain('unlinked');
  });
});
