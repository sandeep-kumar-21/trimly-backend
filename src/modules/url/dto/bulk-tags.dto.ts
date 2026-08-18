import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString, IsOptional, ArrayNotEmpty } from 'class-validator';

export class BulkTagsDto {
  @ApiProperty({ example: ['60d5ec49f1b2c80015b1c8a1', '60d5ec49f1b2c80015b1c8a2'], description: 'Array of link IDs to update' })
  @IsArray()
  @IsString({ each: true })
  @ArrayNotEmpty()
  linkIds: string[];

  @ApiProperty({ example: ['promo', 'summer'], description: 'Tags to add to the specified links', required: false })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  addTags?: string[];

  @ApiProperty({ example: ['old-promo'], description: 'Tags to remove from the specified links', required: false })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  removeTags?: string[];
}
