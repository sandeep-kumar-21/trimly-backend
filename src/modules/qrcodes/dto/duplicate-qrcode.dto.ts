import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class DuplicateQrCodeDto {
  @ApiProperty({ example: 'my-new-code', description: 'Target short code to apply the duplicated design to' })
  @IsString()
  @IsNotEmpty()
  targetShortCode: string;
}
