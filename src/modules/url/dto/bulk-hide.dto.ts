import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString, IsBoolean, ArrayNotEmpty } from 'class-validator';

export class BulkHideDto {
  @ApiProperty({ example: ['60d5ec49f1b2c80015b1c8a1', '60d5ec49f1b2c80015b1c8a2'], description: 'Array of link IDs to hide/unhide' })
  @IsArray()
  @IsString({ each: true })
  @ArrayNotEmpty()
  linkIds: string[];

  @ApiProperty({ example: true, description: 'True to hide, false to unhide' })
  @IsBoolean()
  isHidden: boolean;
}
