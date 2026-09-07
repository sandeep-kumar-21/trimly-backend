import { Controller, Get, Param, Query, UseGuards, Sse, MessageEvent } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { AnalyticsService } from './analytics.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { Public } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';

@ApiTags('Analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get unified aggregate analytics dashboard across all URLs with multi-dimensional filters' })
  @ApiResponse({ status: 200, description: 'Returns complete analytics dashboard payload.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async getDashboardAnalytics(
    @GetUser('userId') userId: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analyticsService.getAnalyticsDashboard(userId, query);
  }

  @UseGuards(JwtAuthGuard)
  @Sse('live')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Stream real-time click telemetry via Server-Sent Events (SSE) backed by Redis Pub/Sub' })
  streamLiveClicks(
    @GetUser('userId') userId: string,
    @Query('shortCode') shortCode?: string,
  ): Observable<MessageEvent> {
    return this.analyticsService.getLiveClickStream(userId, shortCode);
  }

  @UseGuards(JwtAuthGuard)
  @Get('logs')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get paginated detailed click audit log with multi-dimensional search & filtering' })
  @ApiResponse({ status: 200, description: 'Returns paginated click logs.' })
  async getClickLogs(
    @GetUser('userId') userId: string,
    @Query() query: any,
  ) {
    return this.analyticsService.getClickLogs(userId, query);
  }

  @UseGuards(JwtAuthGuard)
  @Get('recent')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get latest 20 real-time clicks for user short links (Live activity stream)' })
  @ApiResponse({ status: 200, description: 'Returns recent click events.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async getRecentActivity(@GetUser('userId') userId: string) {
    return this.analyticsService.getRecentActivity(userId);
  }

  @Public()
  @Get(':code')
  @ApiOperation({ summary: 'Get analytics metrics for a specific short URL' })
  @ApiParam({ name: 'code', description: 'Short URL code' })
  @ApiResponse({ status: 200, description: 'Returns analytics metrics.' })
  @ApiResponse({ status: 404, description: 'Short URL not found.' })
  async getAnalytics(
    @Param('code') code: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analyticsService.getAnalytics(code, query.from, query.to);
  }
}

