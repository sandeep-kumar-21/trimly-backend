import { ConfigService } from '@nestjs/config';
import { RedisOptions } from 'ioredis';

export const getRedisConfig = (configService: ConfigService): RedisOptions => {
  const provider = (configService.get<string>('REDIS_PROVIDER') || 'local').toLowerCase();

  if (provider === 'upstash') {
    const redisUrl = configService.get<string>('REDIS_URL');
    if (!redisUrl) {
      throw new Error('REDIS_URL is required when REDIS_PROVIDER is set to "upstash"');
    }

    try {
      const parsedUrl = new URL(redisUrl);
      return {
        host: parsedUrl.hostname,
        port: parseInt(parsedUrl.port || '6379', 10),
        password: parsedUrl.password ? decodeURIComponent(parsedUrl.password) : undefined,
        username: parsedUrl.username ? decodeURIComponent(parsedUrl.username) : undefined,
        tls: {},
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      };
    } catch (err: any) {
      throw new Error(`Invalid REDIS_URL provided: ${err.message}`);
    }
  }

  // Fallback / Default: Localhost Redis
  const host = configService.get<string>('REDIS_HOST', 'localhost');
  const port = configService.get<number>('REDIS_PORT', 6379);
  const password = configService.get<string>('REDIS_PASSWORD');

  return {
    host,
    port,
    password: password || undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
};
