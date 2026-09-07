import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger, RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { RedirectService } from './modules/redirect/redirect.service';
import * as dns from 'dns';

// Fix Node.js Windows SRV DNS resolution failure by setting reliable public DNS resolvers
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {
  // Ignore if unsupported in runtime environment
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 4000);
  const corsOrigin = configService.get<string>('CORS_ORIGIN', '*');

  // CORS Configuration supporting credentials and wildcards
  app.enableCors({
    origin: (requestOrigin, callback) => {
      if (!corsOrigin || corsOrigin === '*' || !requestOrigin) {
        return callback(null, true);
      }
      const allowed = corsOrigin.split(',').map((o) => o.trim());
      if (allowed.includes(requestOrigin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // Enable Global Prefix '/api' for all standard API endpoints
  app.setGlobalPrefix('api');

  // Root level redirect middleware for GET /:code and GET /s/qrc_preview.html
  app.use(async (req: any, res: any, next: any) => {
    const path = req.path;
    if (
      req.method === 'GET' &&
      !path.startsWith('/api') &&
      !path.startsWith('/favicon.ico') &&
      path.length > 1
    ) {
      if (path === '/s/qrc_preview.html') {
        const redirectService = app.get(RedirectService);
        return res.redirect(302, `${redirectService.frontendUrl}/s/qrc_preview.html`);
      }
      const code = path.substring(1);
      if (!code.includes('/')) {
        try {
          const redirectService = app.get(RedirectService);
          const xForwardedFor = req.headers['x-forwarded-for'] as string;
          const clientIp = xForwardedFor
            ? xForwardedFor.split(',')[0].trim()
            : req.socket?.remoteAddress || '127.0.0.1';
          const referrer = (req.headers['referer'] as string) || (req.headers['referrer'] as string) || null;
          const userAgent = (req.headers['user-agent'] as string) || null;
          const query = req.query || {};
          const isQrScan = query.qr === '1' || query.scan === '1' || query.source === 'qr';
          const utms = {
            utmSource: query.utm_source || null,
            utmMedium: query.utm_medium || null,
            utmCampaign: query.utm_campaign || null,
            utmTerm: query.utm_term || null,
            utmContent: query.utm_content || null,
          };
          const result = await redirectService.getLongUrlAndLogClick(
            code,
            clientIp,
            referrer,
            userAgent,
            isQrScan,
            utms,
          );
          if (typeof result === 'object' && result.passwordProtected) {
            return res.redirect(302, result.redirectUrl);
          }
          return res.redirect(302, result as string);
        } catch {
          // If short code not found, proceed to standard 404 handler
        }
      }
    }
    next();
  });

  // Strict Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Enable Graceful Shutdown Hooks
  app.enableShutdownHooks();

  // Swagger OpenAPI Documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Trimly Backend API')
    .setDescription(
      'Production-grade Bitly-style URL shortener REST API documentation built with NestJS, MongoDB, Redis, and BullMQ.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(port, '0.0.0.0');
  logger.log(`Application running on port ${port} (0.0.0.0)`);
  logger.log(`Swagger documentation available at http://localhost:${port}/api/docs`);
}

bootstrap();
