import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsUrl, IsOptional, IsDateString, IsString, IsMongoId, IsArray, IsBoolean } from 'class-validator';

export class UpdateUrlDto {
  @ApiPropertyOptional({ example: 'https://new-destination.com', description: 'Updated destination URL' })
  @IsUrl({}, { message: 'longUrl must be a valid HTTP or HTTPS URL' })
  @IsOptional()
  longUrl?: string;

  @ApiPropertyOptional({ example: '2030-12-31T23:59:59.000Z', description: 'Updated expiration date (or null to clear)' })
  @IsDateString({}, { message: 'expiresAt must be a valid ISO 8601 date string' })
  @IsOptional()
  expiresAt?: string | null;

  @ApiPropertyOptional({ example: 'Updated Title', description: 'Updated short link title' })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({ example: '60d5ec49f1b2c80015b1c8a1', description: 'Updated campaign ID (or null to unlink)' })
  @IsMongoId()
  @IsOptional()
  campaignId?: string | null;

  @ApiPropertyOptional({ example: 'social', description: 'Updated marketing channel' })
  @IsString()
  @IsOptional()
  channel?: string | null;

  @ApiPropertyOptional({ example: ['updated', 'tags'], description: 'Updated tags list' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ example: 'newpassword123', description: 'Set or update password protection (or null to remove)' })
  @IsString()
  @IsOptional()
  password?: string | null;

  @ApiPropertyOptional({ example: true, description: 'Toggle hidden status of the url' })
  @IsOptional()
  @IsBoolean()
  isHidden?: boolean;

  @ApiPropertyOptional({ example: true, description: 'Toggle whether URL appears as visible link' })
  @IsOptional()
  @IsBoolean()
  visibleAsLink?: boolean;
}
