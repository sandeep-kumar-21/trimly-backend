import { IsString, IsOptional, IsUrl, IsArray, MinLength, MaxLength, Matches, ArrayMaxSize } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class EditBackHalfDto {
  @ApiProperty({ description: 'New custom back-half / alias', example: 'my-custom-promo' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  customAlias: string;

  @ApiPropertyOptional({ description: 'Optional updated destination URL' })
  @IsOptional()
  @IsUrl()
  longUrl?: string;

  @ApiPropertyOptional({ description: 'Optional updated title' })
  @IsOptional()
  @IsString()
  title?: string;

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
}
