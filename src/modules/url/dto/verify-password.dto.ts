import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyPasswordDto {
  @ApiProperty({ example: 'secret123', description: 'Password to unlock short link' })
  @IsNotEmpty()
  @IsString()
  password: string;
}
