import { Injectable, ConflictException, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import Redis from 'ioredis';
import * as bcrypt from 'bcrypt';
import { User, UserDocument } from './schemas/user.schema';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { UserExportQueue } from '../queue/user-export.queue';
import { UserDeleteQueue } from '../queue/user-delete.queue';
import { REDIS_CLIENT } from '../../common/redis/redis.provider';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly userExportQueue: UserExportQueue,
    private readonly userDeleteQueue: UserDeleteQueue,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async create(email: string, passwordHash: string, name?: string): Promise<UserDocument> {
    const existingUser = await this.findByEmail(email);
    if (existingUser) {
      throw new ConflictException('Email is already registered');
    }

    const createdUser = new this.userModel({
      email: email.toLowerCase(),
      passwordHash,
      name: name || null,
    });

    return createdUser.save();
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase() }).exec();
  }

  async findById(id: string | Types.ObjectId): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  async updateProfile(userId: string, updateProfileDto: UpdateProfileDto) {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (updateProfileDto.name !== undefined) {
      user.name = updateProfileDto.name || null;
    }
    if (updateProfileDto.avatarUrl !== undefined) {
      user.avatarUrl = updateProfileDto.avatarUrl || null;
    }

    const saved = await user.save();
    return saved.toJSON();
  }

  async updatePreferences(userId: string, updatePreferencesDto: UpdatePreferencesDto) {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const currentPrefs = user.preferences || { theme: 'system', timezone: 'UTC', notificationsEnabled: true };
    user.preferences = {
      theme: updatePreferencesDto.theme !== undefined ? updatePreferencesDto.theme : currentPrefs.theme,
      timezone: updatePreferencesDto.timezone !== undefined ? updatePreferencesDto.timezone : currentPrefs.timezone,
      notificationsEnabled: updatePreferencesDto.notificationsEnabled !== undefined ? updatePreferencesDto.notificationsEnabled : currentPrefs.notificationsEnabled,
    };

    const saved = await user.save();
    return saved.toJSON();
  }

  async changePassword(userId: string, changePasswordDto: ChangePasswordDto) {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isMatch = await bcrypt.compare(changePasswordDto.currentPassword, user.passwordHash);
    if (!isMatch) {
      throw new BadRequestException('Current password is incorrect');
    }

    user.passwordHash = await bcrypt.hash(changePasswordDto.newPassword, 10);
    await user.save();
    return { message: 'Password updated successfully' };
  }

  async initiateDataExport(userId: string) {
    const jobId = `export_${userId}_${Date.now()}`;
    await this.userExportQueue.addExportJob({ userId, jobId });

    return {
      jobId,
      status: 'pending',
      message: 'Data export queued successfully. Poll GET /api/users/export-data/' + jobId + ' for results.',
    };
  }

  async getExportStatus(jobId: string) {
    const cachedResult = await this.redis.get(`export:${jobId}`);
    if (!cachedResult) {
      return { jobId, status: 'pending', result: null };
    }
    return JSON.parse(cachedResult);
  }

  async initiateAccountDeletion(userId: string, deleteAccountDto: DeleteAccountDto) {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isMatch = await bcrypt.compare(deleteAccountDto.password, user.passwordHash);
    if (!isMatch) {
      throw new BadRequestException('Password confirmation failed: incorrect password');
    }

    const jobId = `delete_${userId}_${Date.now()}`;
    await this.userDeleteQueue.addDeleteJob({ userId, jobId });

    return {
      jobId,
      status: 'pending',
      message: 'Account deletion queued successfully.',
    };
  }
}
