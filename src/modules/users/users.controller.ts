import {
  Controller,
  Patch,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';

@ApiTags('Users / Profile')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Patch('profile')
  @ApiOperation({ summary: 'Update authenticated user profile (name and avatar URL)' })
  @ApiResponse({ status: 200, description: 'Profile updated successfully.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async updateProfile(
    @Body() updateProfileDto: UpdateProfileDto,
    @GetUser('userId') userId: string,
  ) {
    return this.usersService.updateProfile(userId, updateProfileDto);
  }

  @Patch('preferences')
  @ApiOperation({ summary: 'Update user settings and preferences (theme, timezone, notifications)' })
  @ApiResponse({ status: 200, description: 'Preferences updated successfully.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async updatePreferences(
    @Body() updatePreferencesDto: UpdatePreferencesDto,
    @GetUser('userId') userId: string,
  ) {
    return this.usersService.updatePreferences(userId, updatePreferencesDto);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change authenticated user password' })
  @ApiResponse({ status: 200, description: 'Password changed successfully.' })
  @ApiResponse({ status: 400, description: 'Incorrect current password.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async changePassword(
    @Body() changePasswordDto: ChangePasswordDto,
    @GetUser('userId') userId: string,
  ) {
    return this.usersService.changePassword(userId, changePasswordDto);
  }

  @Get('export-data')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Enqueue BullMQ job to export complete user account data' })
  @ApiResponse({ status: 202, description: 'Export job queued in BullMQ. Returns jobId for polling.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async exportData(@GetUser('userId') userId: string) {
    return this.usersService.initiateDataExport(userId);
  }

  @Get('export-data/:jobId')
  @ApiOperation({ summary: 'Poll status and retrieve result for a queued export-data job' })
  @ApiParam({ name: 'jobId', description: 'Export BullMQ job ID' })
  @ApiResponse({ status: 200, description: 'Returns job status and exported JSON payload when ready.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async getExportStatus(@Param('jobId') jobId: string) {
    return this.usersService.getExportStatus(jobId);
  }

  @Delete('account')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Enqueue BullMQ job to cascade delete account and all associated resources' })
  @ApiResponse({ status: 202, description: 'Account deletion job queued in BullMQ.' })
  @ApiResponse({ status: 400, description: 'Password confirmation failed.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async deleteAccount(
    @Body() deleteAccountDto: DeleteAccountDto,
    @GetUser('userId') userId: string,
  ) {
    return this.usersService.initiateAccountDeletion(userId, deleteAccountDto);
  }
}
