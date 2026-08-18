import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdatePreferencesDto {
  @ApiPropertyOptional({ example: 'dark', description: 'UI Theme (light, dark, system)' })
  @IsString()
  @IsOptional()
  theme?: string;

  @ApiPropertyOptional({ example: 'America/New_York', description: 'User timezone' })
  @IsString()
  @IsOptional()
  timezone?: string;

  @ApiPropertyOptional({ example: true, description: 'Notification preference' })
  @IsBoolean()
  @IsOptional()
  notificationsEnabled?: boolean;
}
