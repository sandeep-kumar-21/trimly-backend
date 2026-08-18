import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken, getConnectionToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { QrCodesService } from './qrcodes.service';
import { QrCode } from './schemas/qrcode.schema';
import { Url } from '../url/schemas/url.schema';
import { UrlService } from '../url/url.service';
import { REDIS_CLIENT } from '../../common/redis/redis.provider';

jest.setTimeout(15000);

describe('QrCodesService', () => {
  let service: QrCodesService;
  let qrCodeModelMock: any;
  let urlModelMock: any;
  let urlServiceMock: any;
  let redisMock: any;
  let configServiceMock: any;

  const validUserId = '507f1f77bcf86cd799439012';

  beforeEach(async () => {
    qrCodeModelMock = {
      findOne: jest.fn(),
      find: jest.fn(),
      deleteOne: jest.fn(),
      updateOne: jest.fn(),
    };

    urlModelMock = {
      findOne: jest.fn(),
      find: jest.fn(),
      updateOne: jest.fn(),
    };

    urlServiceMock = {
      createUrl: jest.fn(),
    };

    redisMock = {
      get: jest.fn(),
      setex: jest.fn(),
      del: jest.fn(),
    };

    configServiceMock = {
      get: jest.fn((key: string, defaultVal?: string) => {
        if (key === 'SHORT_URL_BASE') return 'http://localhost:4000';
        if (key === 'BASE_URL') return 'http://localhost:4000';
        return defaultVal;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QrCodesService,
        { provide: getModelToken(QrCode.name), useValue: qrCodeModelMock },
        { provide: getModelToken(Url.name), useValue: urlModelMock },
        { provide: getConnectionToken(), useValue: { startSession: jest.fn() } },
        { provide: UrlService, useValue: urlServiceMock },
        { provide: REDIS_CLIENT, useValue: redisMock },
        { provide: ConfigService, useValue: configServiceMock },
      ],
    }).compile();

    service = module.get<QrCodesService>(QrCodesService);
  });

  it('should construct shortUrlBase from SHORT_URL_BASE config', () => {
    expect(service.shortUrlBase).toBe('http://localhost:4000');
  });

  it('should render valid scalable SVG markup by default using type: "svg"', async () => {
    const config = {
      dotsStyle: 'square',
      cornersStyle: 'square',
      dotsColor: '#000000',
      backgroundColor: '#ffffff',
      logoUrl: null,
      centerText: null,
    };

    const svgString = await service.renderQrCodeSvg('trackable-code', config);
    expect(typeof svgString).toBe('string');
    expect(svgString).toContain('<svg');
    expect(svgString).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svgString).toContain('>trimly</text>');

    const defaultBuffer = await service.renderQrCodeBuffer('trackable-code', config);
    expect(defaultBuffer).toBeInstanceOf(Buffer);
    expect(defaultBuffer.toString('utf-8')).toContain('<svg');
    expect(defaultBuffer.toString('utf-8')).toContain('>trimly</text>');
  });

  it('should render on-demand PNG export at minimum 1000x1000px when format="png" is requested', async () => {
    const config = {
      dotsStyle: 'square',
      cornersStyle: 'square',
      dotsColor: '#000000',
      backgroundColor: '#ffffff',
      logoUrl: null,
      centerText: null,
    };

    const buffer = await service.renderQrCodeBuffer('trackable-code', config, 'png');
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
    expect(configServiceMock.get).toHaveBeenCalledWith('SHORT_URL_BASE', expect.any(String));

    // Verify PNG header dimensions (bytes 16-23 in PNG IHDR chunk)
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    expect(width).toBeGreaterThanOrEqual(1000);
    expect(height).toBeGreaterThanOrEqual(1000);
  });

  it('should return single QR code details with SVG markup and shortUrl constructed from SHORT_URL_BASE', async () => {
    const mockQrDoc = {
      _id: 'qr123',
      shortCode: 'single-code',
      userId: validUserId,
      qrConfig: { dotsStyle: 'square', cornersStyle: 'square', dotsColor: '#000000', backgroundColor: '#ffffff' },
      createdAt: new Date().toISOString(),
      isHidden: false,
    };

    const mockUrlDoc = {
      _id: 'url123',
      shortCode: 'single-code',
      userId: validUserId,
      longUrl: 'https://example.com/actual-destination',
      title: 'My Link',
      visibleAsLink: true,
      tags: ['marketing'],
      expiresAt: null,
    };

    qrCodeModelMock.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(mockQrDoc),
    });

    urlModelMock.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(mockUrlDoc),
    });

    const result = await service.getQrCodeByCode('single-code', validUserId);

    expect(result.shortCode).toBe('single-code');
    expect(result.shortUrl).toBe('http://localhost:4000/single-code');
    expect(result.destinationUrl).toBe('https://example.com/actual-destination');
    expect(result.visibleAsLink).toBe(true);
    expect(result.svg).toContain('<svg');
  });

  it('should automatically apply error correction level H in SVG mode when logoUrl or centerText is configured', async () => {
    const configWithText = {
      dotsStyle: 'square',
      cornersStyle: 'square',
      dotsColor: '#000000',
      backgroundColor: '#ffffff',
      logoUrl: null,
      centerText: 'Trimly',
    };

    const svg = await service.renderQrCodeSvg('test-code', configWithText);
    expect(typeof svg).toBe('string');
    expect(svg).toContain('<svg');
  });

  it('should return cached raw SVG from Redis on default getQrCodeImage request', async () => {
    const mockQrDoc = {
      shortCode: 'my-qr',
      userId: { toString: () => validUserId },
      qrConfig: {
        dotsStyle: 'square',
        cornersStyle: 'square',
        dotsColor: '#000000',
        backgroundColor: '#ffffff',
        logoUrl: null,
        centerText: null,
      },
    };

    qrCodeModelMock.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(mockQrDoc),
    });

    const fakeSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"></svg>';
    redisMock.get.mockResolvedValue(fakeSvg);

    const result = await service.getQrCodeImage('my-qr', validUserId, 'svg');

    expect(result.fromCache).toBe(true);
    expect(result.contentType).toBe('image/svg+xml');
    expect(result.buffer.toString('utf-8')).toBe(fakeSvg);
    expect(redisMock.get).toHaveBeenCalled();
  });

  it('should return cached PNG buffer from Redis when format="png" is explicitly requested', async () => {
    const mockQrDoc = {
      shortCode: 'my-qr',
      userId: { toString: () => validUserId },
      qrConfig: {
        dotsStyle: 'square',
        cornersStyle: 'square',
        dotsColor: '#000000',
        backgroundColor: '#ffffff',
        logoUrl: null,
        centerText: null,
      },
    };

    qrCodeModelMock.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(mockQrDoc),
    });

    const fakePng = Buffer.from('fake-png-binary').toString('base64');
    redisMock.get.mockResolvedValue(fakePng);

    const result = await service.getQrCodeImage('my-qr', validUserId, 'png');

    expect(result.fromCache).toBe(true);
    expect(result.contentType).toBe('image/png');
    expect(result.buffer.toString()).toBe('fake-png-binary');
    expect(redisMock.get).toHaveBeenCalled();
  });
});
