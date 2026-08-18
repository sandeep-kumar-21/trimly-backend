import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { QrCodesService } from '../src/modules/qrcodes/qrcodes.service';

jest.setTimeout(30000);

describe('QrCodes (e2e)', () => {
  let app: INestApplication;

  const mockUser = { userId: '507f1f77bcf86cd799439012', email: 'e2e@example.com' };

  const mockQrCodesService = {
    createQrCode: jest.fn().mockResolvedValue({
      qrCode: {
        _id: '507f1f77bcf86cd799439099',
        shortCode: 'e2e-code',
        qrConfig: { dotsStyle: 'square' },
      },
      imageBase64: 'data:image/png;base64,fakeData',
    }),
    getUserQrCodes: jest.fn().mockResolvedValue([
      { shortCode: 'e2e-code', qrConfig: { dotsStyle: 'square' } },
    ]),
    getQrCodeImage: jest.fn().mockResolvedValue({
      buffer: Buffer.from('fake-image-bytes'),
      fromCache: false,
    }),
    deleteQrCode: jest.fn().mockResolvedValue({ message: 'QR Code successfully deleted' }),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          const req = context.switchToHttp().getRequest();
          req.user = mockUser;
          return true;
        },
      })
      .overrideProvider(QrCodesService)
      .useValue(mockQrCodesService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('POST /api/qrcodes - Create QR code', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/qrcodes')
      .send({
        shortCode: 'e2e-code',
        qrConfig: {
          dotsStyle: 'square',
          dotsColor: '#000000',
        },
      })
      .expect(201);

    expect(res.body.imageBase64).toBeDefined();
  });

  it('GET /api/qrcodes/:code - Fetch rendered QR image', async () => {
    await request(app.getHttpServer())
      .get('/api/qrcodes/e2e-code')
      .expect(200)
      .expect('Content-Type', /image\/png/);
  });

  it('DELETE /api/qrcodes/:code - Delete QR code', async () => {
    const res = await request(app.getHttpServer())
      .delete('/api/qrcodes/e2e-code')
      .expect(200);

    expect(res.body.message).toContain('deleted');
  });
});
