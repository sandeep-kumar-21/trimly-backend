import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateQrCodeDto {
  @ApiPropertyOptional({ example: true, description: 'Toggle hidden status of the QR code' })
  @IsBoolean()
  @IsOptional()
  isHidden?: boolean;
}
