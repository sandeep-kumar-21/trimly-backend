import { IsOptional, IsString, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class AnalyticsQueryDto {
  @ApiPropertyOptional({ description: 'Filter for a specific shortCode' })
  @IsOptional()
  @IsString()
  shortCode?: string;

  @ApiPropertyOptional({ description: 'Filter by Campaign ID' })
  @IsOptional()
  @IsString()
  campaignId?: string;

  @ApiPropertyOptional({ description: 'Filter by marketing channel' })
  @IsOptional()
  @IsString()
  channel?: string;

  @ApiPropertyOptional({ description: 'Start date (ISO String YYYY-MM-DD or ISO timestamp)' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'End date (ISO String YYYY-MM-DD or ISO timestamp)' })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional({ description: 'Preset time range', enum: ['24h', '7d', '30d', '90d', 'all', 'custom'] })
  @IsOptional()
  @IsString()
  preset?: '24h' | '7d' | '30d' | '90d' | 'all' | 'custom';

  @ApiPropertyOptional({ description: 'Time-series aggregation bucket interval', enum: ['hourly', 'daily', 'monthly'] })
  @IsOptional()
  @IsIn(['hourly', 'daily', 'monthly'])
  interval?: 'hourly' | 'daily' | 'monthly';
}
