import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, IsUrl, ArrayMinSize, ArrayMaxSize, MaxLength } from 'class-validator';

export class AddCampaignLinksDto {
  @ApiProperty({ example: 'https://example.com/products/promo', description: 'Base destination URL to shorten across channels' })
  @IsUrl({}, { message: 'destinationUrl must be a valid HTTP or HTTPS URL' })
  @IsNotEmpty()
  destinationUrl: string;

  @ApiPropertyOptional({ example: 'Fall Product Launch', description: 'Optional base title for the links' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  title?: string;

  @ApiProperty({ example: ['email', 'social', 'sms'], description: 'List of marketing channels to generate links for (max 20)' })
  @IsArray()
  @ArrayMinSize(1, { message: 'Must specify at least one channel' })
  @ArrayMaxSize(20, { message: 'Cannot generate links for more than 20 channels in a single batch' })
  @IsString({ each: true })
  channels: string[];

  @ApiPropertyOptional({ example: true, description: 'Whether to automatically append utm_source, utm_medium, and utm_campaign parameters', default: true })
  @IsBoolean()
  @IsOptional()
  autoUtm?: boolean;

  @ApiPropertyOptional({ example: 'fall-promo', description: 'Optional custom alias prefix for the generated links' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  customAliasPrefix?: string;
}
