import { IsString, IsOptional, IsUrl, IsArray, MinLength, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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

  @ApiPropertyOptional({ description: 'Optional updated tags' })
  @IsOptional()
  @IsArray()
  tags?: string[];
}
