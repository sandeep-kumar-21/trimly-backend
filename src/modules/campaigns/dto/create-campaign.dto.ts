import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCampaignDto {
  @ApiProperty({ example: 'Summer Marketing 2026', description: 'Name of the campaign' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: 'Campaign for Q3 promotional links', description: 'Optional description' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;
}
