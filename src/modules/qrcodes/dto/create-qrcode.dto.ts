import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class QrConfigDto {
  @ApiPropertyOptional({ example: 'square', description: 'Style of QR code dots (dots, rounded, square, extra-rounded)' })
  @IsString()
  @IsOptional()
  dotsStyle?: string;

  @ApiPropertyOptional({ example: 'square', description: 'Style of QR code corners (square, dot, extra-rounded)' })
  @IsString()
  @IsOptional()
  cornersStyle?: string;

  @ApiPropertyOptional({ example: 'square', description: 'Style of QR code corner inner dots (square, dot)' })
  @IsString()
  @IsOptional()
  cornersDotStyle?: string;

  @ApiPropertyOptional({ example: '#000000', description: 'Color of QR code dots in hex' })
  @IsString()
  @IsOptional()
  dotsColor?: string;

  @ApiPropertyOptional({ example: '#ffffff', description: 'Background color of QR code in hex' })
  @IsString()
  @IsOptional()
  backgroundColor?: string;

  @ApiPropertyOptional({ example: 'https://example.com/logo.png', description: 'Optional center logo image URL' })
  @IsString()
  @IsOptional()
  logoUrl?: string | null;

  @ApiPropertyOptional({ example: 'Trimly', description: 'Optional center overlay text' })
  @IsString()
  @IsOptional()
  centerText?: string | null;
}

export class CreateQrCodeDto {
  @ApiPropertyOptional({ example: 'my-short-code', description: 'Short code of URL to generate QR code for (optional if longUrl provided)' })
  @IsOptional()
  @IsString()
  shortCode?: string;

  @ApiPropertyOptional({ example: 'https://example.com/target', description: 'Target destination URL (if creating new link for QR)' })
  @IsOptional()
  @IsString()
  longUrl?: string;

  @ApiPropertyOptional({ example: 'My QR Code Title', description: 'Optional title' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ example: ['marketing'], description: 'Optional tags' })
  @IsOptional()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ example: false, description: 'Whether to also make this visible as a short link in links list' })
  @IsOptional()
  createLink?: boolean;

  @ApiProperty({ description: 'QR code customization parameters' })
  @ValidateNested()
  @Type(() => QrConfigDto)
  qrConfig: QrConfigDto;
}
