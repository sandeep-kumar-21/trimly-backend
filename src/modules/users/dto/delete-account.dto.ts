import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class DeleteAccountDto {
  @ApiProperty({ example: 'CurrentPassword123!', description: 'Current user password for confirmation' })
  @IsNotEmpty()
  @IsString()
  password: string;
}
