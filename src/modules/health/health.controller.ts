import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Public } from '../../common/decorators/public.decorator';
import { getRedisConfig } from '../../config/redis.config';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  private readonly redis: Redis;

  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly configService: ConfigService,
  ) {
    const redisOptions = getRedisConfig(this.configService);
    this.redis = new Redis(redisOptions);
  }

  @Public()
  @Get()
  @ApiOperation({ summary: 'Health check endpoint for uptime and wake-up cron services' })
  @ApiResponse({ status: 200, description: 'Application services health status.' })
  async checkHealth() {
    let dbStatus = 'disconnected';
    let redisStatus = 'disconnected';

    try {
      if (this.connection.readyState === 1) {
        dbStatus = 'connected';
      }
    } catch {
      dbStatus = 'error';
    }

    try {
      const ping = await this.redis.ping();
      if (ping === 'PONG') {
        redisStatus = 'connected';
      }
    } catch {
      redisStatus = 'error';
    }

    return {
      status: dbStatus === 'connected' && redisStatus === 'connected' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        database: dbStatus,
        redis: redisStatus,
      },
    };
  }
}
