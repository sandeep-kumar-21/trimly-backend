import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ example: 'OldPassword123!', description: 'Current user password' })
  @IsNotEmpty()
  @IsString()
  currentPassword: string;

  @ApiProperty({ example: 'NewPassword123!', description: 'New user password' })
  @IsNotEmpty()
  @IsString()
  @MinLength(6, { message: 'newPassword must be at least 6 characters long' })
  newPassword: string;
}
