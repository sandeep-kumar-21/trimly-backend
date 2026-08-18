import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl } from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'John Doe', description: 'User full name' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: 'https://example.com/avatar.jpg', description: 'Avatar image URL' })
  @IsUrl({}, { message: 'avatarUrl must be a valid HTTP/HTTPS URL' })
  @IsOptional()
  avatarUrl?: string | null;
}
