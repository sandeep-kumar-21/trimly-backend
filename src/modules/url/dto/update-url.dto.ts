import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsUrl,
  IsOptional,
  IsDateString,
  IsString,
  IsMongoId,
  IsArray,
  IsBoolean,
  ArrayMaxSize,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';

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

  @ApiPropertyOptional({ example: ['updated', 'tags'], description: 'Updated tags list (max 10 tags, max 7 chars each)' })
  @IsOptional()
  @Transform(({ value }) =>
    Array.isArray(value)
      ? value
          .map((t) => (typeof t === 'string' ? t.replace(/[^a-zA-Z0-9_-]/g, '').trim().slice(0, 7) : t))
          .filter(Boolean)
      : value,
  )
  @IsArray({ message: 'tags must be an array of strings' })
  @ArrayMaxSize(10, { message: 'A link cannot have more than 10 tags' })
  @IsString({ each: true })
  @MaxLength(7, { each: true, message: 'Each tag cannot exceed 7 characters' })
  @MinLength(1, { each: true, message: 'Tag cannot be empty' })
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    each: true,
    message: 'Tags can only contain alphanumeric characters, hyphens, and underscores',
  })
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
