import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { RedirectService } from './redirect.service';
import { Url } from '../url/schemas/url.schema';
import { ClickQueue } from '../queue/click.queue';

// Mock ioredis
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    get: jest.fn().mockResolvedValue(null),
    setex: jest.fn().mockResolvedValue('OK'),
    disconnect: jest.fn(),
  }));
});

describe('RedirectService', () => {
  let service: RedirectService;
  let urlModelMock: any;
  let clickQueueMock: any;

  beforeEach(async () => {
    urlModelMock = {
      findOne: jest.fn(),
    };
    clickQueueMock = {
      addClickJob: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedirectService,
        { provide: getModelToken(Url.name), useValue: urlModelMock },
        { provide: ClickQueue, useValue: clickQueueMock },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('http://localhost:3000') },
        },
      ],
    }).compile();

    service = module.get<RedirectService>(RedirectService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('should return longUrl on DB hit and enqueue click job', async () => {
    const mockUrlDoc = {
      shortCode: 'abc12',
      longUrl: 'https://destination.com',
      expiresAt: null,
    };
    urlModelMock.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(mockUrlDoc),
    });

    const result = await service.getLongUrlAndLogClick(
      'abc12',
      '127.0.0.1',
      'https://google.com',
      'Mozilla/5.0',
    );

    expect(result).toBe('https://destination.com');
    expect(clickQueueMock.addClickJob).toHaveBeenCalledWith(
      expect.objectContaining({ shortCode: 'abc12' }),
    );
  });

  it('should return passwordProtected object with redirectUrl when link has passwordHash', async () => {
    const mockProtectedDoc = {
      shortCode: 'prot1',
      longUrl: 'https://destination.com',
      passwordHash: 'hashed_password',
      expiresAt: null,
    };
    urlModelMock.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(mockProtectedDoc),
    });

    const result = await service.getLongUrlAndLogClick(
      'prot1',
      '127.0.0.1',
      null,
      null,
    );

    expect(result).toEqual({
      passwordProtected: true,
      redirectUrl: 'http://localhost:3000/protected/prot1',
    });
  });

  it('should throw NotFoundException if shortCode is not found', async () => {
    urlModelMock.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });

    await expect(
      service.getLongUrlAndLogClick('notfound', '127.0.0.1', null, null),
    ).rejects.toThrow(NotFoundException);
  });

  it('should throw NotFoundException if shortCode has expired', async () => {
    const expiredDoc = {
      shortCode: 'exp12',
      longUrl: 'https://destination.com',
      expiresAt: new Date(Date.now() - 10000), // Past date
    };
    urlModelMock.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(expiredDoc),
    });

    await expect(
      service.getLongUrlAndLogClick('exp12', '127.0.0.1', null, null),
    ).rejects.toThrow(NotFoundException);
  });
});
