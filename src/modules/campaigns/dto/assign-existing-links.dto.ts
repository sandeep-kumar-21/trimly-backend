import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsOptional, IsString, ArrayMinSize, ArrayMaxSize } from 'class-validator';

export class AssignExistingLinksDto {
  @ApiProperty({
    example: ['60d5ec49f1b2c80015b1c8a1', '60d5ec49f1b2c80015b1c8a2'],
    description: 'Array of link ObjectIds to assign to this campaign (max 25)',
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'Must provide at least one link ID' })
  @ArrayMaxSize(25, { message: 'Cannot assign more than 25 links in a single batch' })
  @IsString({ each: true })
  linkIds: string[];

  @ApiPropertyOptional({ example: 'social', description: 'Optional channel to assign to these links' })
  @IsString()
  @IsOptional()
  channel?: string;
}
