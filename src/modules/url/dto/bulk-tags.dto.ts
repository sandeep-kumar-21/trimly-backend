import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsString, IsOptional, ArrayNotEmpty, MaxLength, MinLength, Matches, ArrayMaxSize } from 'class-validator';

export class BulkTagsDto {
  @ApiProperty({ example: ['60d5ec49f1b2c80015b1c8a1', '60d5ec49f1b2c80015b1c8a2'], description: 'Array of link IDs to update' })
  @IsArray()
  @IsString({ each: true })
  @ArrayNotEmpty()
  linkIds: string[];

  @ApiProperty({ example: ['promo', 'sale24'], description: 'Tags to add to the specified links (max 7 chars each)', required: false })
  @IsOptional()
  @Transform(({ value }) =>
    Array.isArray(value)
      ? value
          .map((t) => (typeof t === 'string' ? t.replace(/[^a-zA-Z0-9_-]/g, '').trim().slice(0, 7) : t))
          .filter(Boolean)
      : value,
  )
  @IsArray()
  @ArrayMaxSize(10, { message: 'Cannot add more than 10 tags at once' })
  @IsString({ each: true })
  @MaxLength(7, { each: true, message: 'Each tag cannot exceed 7 characters' })
  @MinLength(1, { each: true, message: 'Tag cannot be empty' })
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    each: true,
    message: 'Tags can only contain alphanumeric characters, hyphens, and underscores',
  })
  addTags?: string[];

  @ApiProperty({ example: ['old-tag'], description: 'Tags to remove from the specified links', required: false })
  @IsOptional()
  @Transform(({ value }) =>
    Array.isArray(value)
      ? value
          .map((t) => (typeof t === 'string' ? t.replace(/[^a-zA-Z0-9_-]/g, '').trim().slice(0, 7) : t))
          .filter(Boolean)
      : value,
  )
  @IsArray()
  @IsString({ each: true })
  removeTags?: string[];
}
