import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken, getConnectionToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { UrlService } from './url.service';
import { Url } from './schemas/url.schema';
import { QrCode } from '../qrcodes/schemas/qrcode.schema';
import { Counter } from '../../database/counter.schema';
import { REDIS_CLIENT } from '../../common/redis/redis.provider';
import { UrlMetadataQueue } from '../queue/url-metadata.queue';

describe('UrlService', () => {
  let service: UrlService;
  let urlModelMock: any;
  let qrCodeModelMock: any;
  let counterModelMock: any;
  let redisMock: any;

  beforeEach(async () => {
    urlModelMock = function (doc: any) {
      return {
        ...doc,
        save: jest.fn().mockResolvedValue({
          _id: '507f1f77bcf86cd799439011',
          ...doc,
          toObject: () => ({ _id: '507f1f77bcf86cd799439011', ...doc }),
        }),
      };
    };
    urlModelMock.findOne = jest.fn();
    urlModelMock.find = jest.fn();
    urlModelMock.deleteOne = jest.fn();

    qrCodeModelMock = {
      findOne: jest.fn(),
      find: jest.fn(),
      deleteOne: jest.fn(),
    };

    counterModelMock = {
      findOneAndUpdate: jest.fn().mockResolvedValue({ seq: 100 }),
    };

    redisMock = {
      get: jest.fn(),
      setex: jest.fn(),
      del: jest.fn().mockResolvedValue(1),
      keys: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UrlService,
        { provide: getModelToken(Url.name), useValue: urlModelMock },
        { provide: getModelToken(QrCode.name), useValue: qrCodeModelMock },
        { provide: getModelToken(Counter.name), useValue: counterModelMock },
        { provide: getConnectionToken(), useValue: { startSession: jest.fn() } },
        { provide: REDIS_CLIENT, useValue: redisMock },
        {
          provide: UrlMetadataQueue,
          useValue: { addScrapeTitleJob: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultVal?: string) => {
              if (key === 'BASE_URL') return 'http://localhost:3000';
              if (key === 'SHORT_URL_BASE') return 'http://localhost:4000';
              return defaultVal || 'http://localhost:3000';
            }),
          },
        },
      ],
    }).compile();

    service = module.get<UrlService>(UrlService);
  });

  it('should throw ConflictException if custom alias already exists', async () => {
    urlModelMock.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ shortCode: 'alias1' }),
    });

    await expect(
      service.createUrl({
        longUrl: 'https://example.com',
        customAlias: 'alias1',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('should create URL and return formatted shortUrl from SHORT_URL_BASE', async () => {
    urlModelMock.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });

    const result = await service.createUrl({
      longUrl: 'https://example.com',
    });

    expect(result.shortUrl).toBe('http://localhost:4000/1C');
    expect(result.longUrl).toBe('https://example.com');
  });

  it('should hash password when creating password-protected link', async () => {
    urlModelMock.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });

    const result = await service.createUrl({
      longUrl: 'https://example.com',
      password: 'secretPassword123',
    });

    expect(result.passwordProtected).toBe(true);
    expect((result as any).passwordHash).toBeUndefined();
  });

  it('should explicitly invalidate Redis cache key (url:code) on Url update', async () => {
    const mockUrlDoc = {
      _id: '507f1f77bcf86cd799439011',
      shortCode: 'upd123',
      userId: 'user1',
      longUrl: 'https://old.com',
      save: jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439011',
        shortCode: 'upd123',
        userId: 'user1',
        longUrl: 'https://new.com',
        toObject: () => ({
          _id: '507f1f77bcf86cd799439011',
          shortCode: 'upd123',
          userId: 'user1',
          longUrl: 'https://new.com',
        }),
      }),
    };

    urlModelMock.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(mockUrlDoc),
    });

    await service.updateUrl('upd123', { longUrl: 'https://new.com' }, 'user1');

    expect(redisMock.del).toHaveBeenCalledWith('url:upd123', expect.anything(), expect.anything());
  });
});
