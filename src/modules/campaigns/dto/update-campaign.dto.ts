import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateCampaignDto {
  @ApiPropertyOptional({ example: 'Updated Campaign Name', description: 'Updated campaign name' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 'Updated campaign description', description: 'Updated description' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;
}
