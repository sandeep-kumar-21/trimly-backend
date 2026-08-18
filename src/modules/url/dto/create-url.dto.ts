import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsUrl, IsNotEmpty, IsOptional, IsString, IsDateString, Matches, IsMongoId } from 'class-validator';

export class CreateUrlDto {
  @ApiProperty({ example: 'https://example.com/very/long/url/path', description: 'Destination URL' })
  @IsUrl({}, { message: 'longUrl must be a valid HTTP or HTTPS URL' })
  @IsNotEmpty()
  longUrl: string;

  @ApiPropertyOptional({ example: 'my-custom-link', description: 'Optional custom alias for short code' })
  @IsString()
  @IsOptional()
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: 'customAlias can only contain letters, numbers, hyphens, and underscores',
  })
  customAlias?: string;

  @ApiPropertyOptional({ example: '2030-12-31T23:59:59.000Z', description: 'Optional expiration timestamp' })
  @IsDateString({}, { message: 'expiresAt must be a valid ISO 8601 date string' })
  @IsOptional()
  expiresAt?: string;

  @ApiPropertyOptional({ example: '60d5ec49f1b2c80015b1c8a1', description: 'Optional campaign ID' })
  @IsMongoId()
  @IsOptional()
  campaignId?: string;

  @ApiPropertyOptional({ example: 'email', description: 'Optional marketing channel (e.g. email, social, sms, paid, other)' })
  @IsString()
  @IsOptional()
  channel?: string;

  @ApiPropertyOptional({ example: 'My Short Link', description: 'Optional descriptive title for the short link' })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({ example: ['marketing', 'promo'], description: 'Optional tags for categorization' })
  @IsOptional()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ example: 'secret123', description: 'Optional password protection' })
  @IsString()
  @IsOptional()
  password?: string;

  @ApiPropertyOptional({ example: 'google', description: 'UTM source parameter' })
  @IsString()
  @IsOptional()
  utmSource?: string;

  @ApiPropertyOptional({ example: 'cpc', description: 'UTM medium parameter' })
  @IsString()
  @IsOptional()
  utmMedium?: string;

  @ApiPropertyOptional({ example: 'summer_sale', description: 'UTM campaign parameter' })
  @IsString()
  @IsOptional()
  utmCampaign?: string;

  @ApiPropertyOptional({ example: 'shoes', description: 'UTM term parameter' })
  @IsString()
  @IsOptional()
  utmTerm?: string;

  @ApiPropertyOptional({ example: 'banner_top', description: 'UTM content parameter' })
  @IsString()
  @IsOptional()
  utmContent?: string;
}
