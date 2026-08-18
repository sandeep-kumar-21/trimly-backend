import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
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
  @ApiOperation({ summary: 'Get overall aggregate analytics across all URLs created by current user' })
  @ApiQuery({ name: 'from', required: false, description: 'Filter start date (ISO string YYYY-MM-DD)' })
  @ApiQuery({ name: 'to', required: false, description: 'Filter end date (ISO string YYYY-MM-DD)' })
  @ApiResponse({ status: 200, description: 'Returns aggregate analytics for authenticated user.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async getUserOverallAnalytics(
    @GetUser('userId') userId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.analyticsService.getUserOverallAnalytics(userId, from, to);
  }

  @Public()
  @Get(':code')
  @ApiOperation({ summary: 'Get click metrics, time-series, referrers, devices, browsers & country breakdown for a specific short URL' })
  @ApiParam({ name: 'code', description: 'Short URL code' })
  @ApiQuery({ name: 'from', required: false, description: 'Filter start date (ISO string YYYY-MM-DD)' })
  @ApiQuery({ name: 'to', required: false, description: 'Filter end date (ISO string YYYY-MM-DD)' })
  @ApiResponse({ status: 200, description: 'Returns analytics metrics.' })
  @ApiResponse({ status: 404, description: 'Short URL not found.' })
  async getAnalytics(
    @Param('code') code: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.analyticsService.getAnalytics(code, from, to);
  }
}
