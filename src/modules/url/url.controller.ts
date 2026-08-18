import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { UrlService } from './url.service';
import { CreateUrlDto } from './dto/create-url.dto';
import { UpdateUrlDto } from './dto/update-url.dto';
import { EditBackHalfDto } from './dto/edit-back-half.dto';
import { BulkTagsDto } from './dto/bulk-tags.dto';
import { BulkHideDto } from './dto/bulk-hide.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { Public } from '../../common/decorators/public.decorator';

import { Throttle } from '@nestjs/throttler';
import { VerifyPasswordDto } from './dto/verify-password.dto';

@ApiTags('URLs')
@Controller('urls')
export class UrlController {
  constructor(private readonly urlService: UrlService) {}

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Post()
  @ApiOperation({ summary: 'Create a short URL (supports anonymous or authenticated users)' })
  @ApiResponse({ status: 201, description: 'Short URL created successfully.' })
  @ApiResponse({ status: 400, description: 'Validation error.' })
  @ApiResponse({ status: 409, description: 'Custom alias is already taken.' })
  async createUrl(
    @Body() createUrlDto: CreateUrlDto,
    @GetUser() user?: any,
  ) {
    const userId = user?.userId || null;
    return this.urlService.createUrl(createUrlDto, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all URLs created by the authenticated user' })
  @ApiResponse({ status: 200, description: 'Returns list of user URLs.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async getUserUrls(
    @GetUser('userId') userId: string,
    @Query('tags') tags?: string | string[],
    @Query('linkType') linkType?: 'all' | 'custom' | 'auto',
    @Query('qrAttachment') qrAttachment?: 'all' | 'with' | 'without',
  ) {
    let parsedTags: string[] | undefined;
    if (tags) {
      if (Array.isArray(tags)) {
        parsedTags = tags;
      } else if (typeof tags === 'string') {
        parsedTags = tags.split(',').map((t) => t.trim());
      }
    }
    return this.urlService.getUserUrls(userId, {
      tags: parsedTags,
      linkType,
      qrAttachment,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get('tags')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get distinct tags used by the authenticated user' })
  @ApiResponse({ status: 200, description: 'Returns list of distinct tags.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async getTags(@GetUser('userId') userId: string) {
    return this.urlService.getDistinctTags(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('bulk-tags')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Bulk add/remove tags for specified links' })
  @ApiResponse({ status: 200, description: 'Links updated successfully.' })
  @ApiResponse({ status: 403, description: 'Forbidden (one or more links do not belong to user).' })
  async bulkUpdateTags(
    @Body() bulkTagsDto: BulkTagsDto,
    @GetUser('userId') userId: string,
  ) {
    return this.urlService.bulkUpdateTags(userId, bulkTagsDto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('bulk-hide')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Bulk hide/unhide specified links' })
  @ApiResponse({ status: 200, description: 'Links hidden/unhidden successfully.' })
  @ApiResponse({ status: 403, description: 'Forbidden (one or more links do not belong to user).' })
  async bulkHideUrls(
    @Body() bulkHideDto: BulkHideDto,
    @GetUser('userId') userId: string,
  ) {
    return this.urlService.bulkHideUrls(userId, bulkHideDto);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':code/promote-to-link')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Promote a QR-only link to a visible link in links list' })
  @ApiParam({ name: 'code', description: 'Short code or custom alias' })
  @ApiResponse({ status: 200, description: 'URL successfully promoted to visible link.' })
  @ApiResponse({ status: 403, description: 'Forbidden (not link owner).' })
  @ApiResponse({ status: 404, description: 'Short URL not found.' })
  async promoteToLink(
    @Param('code') code: string,
    @GetUser('userId') userId: string,
  ) {
    return this.urlService.promoteToLink(code, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':code/edit-back-half')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new short link with a custom back-half, copying all fields from source URL' })
  @ApiParam({ name: 'code', description: 'Source short code' })
  @ApiResponse({ status: 201, description: 'New short link created with custom alias.' })
  @ApiResponse({ status: 403, description: 'Forbidden (not link owner).' })
  @ApiResponse({ status: 404, description: 'Source short URL not found.' })
  @ApiResponse({ status: 409, description: 'Custom alias is already taken.' })
  async editBackHalf(
    @Param('code') code: string,
    @Body() editBackHalfDto: EditBackHalfDto,
    @GetUser('userId') userId: string,
  ) {
    return this.urlService.editBackHalf(code, userId, editBackHalfDto);
  }

  @Public()
  @Get(':code')
  @ApiOperation({ summary: 'Get metadata for a short URL by code' })
  @ApiParam({ name: 'code', description: 'Short code or custom alias' })
  @ApiResponse({ status: 200, description: 'Returns short URL metadata.' })
  @ApiResponse({ status: 404, description: 'Short URL not found.' })
  async getUrlMetadata(@Param('code') code: string) {
    return this.urlService.getUrlMetadata(code);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post(':code/verify-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify password for a password-protected short URL (rate limited)' })
  @ApiParam({ name: 'code', description: 'Short code or custom alias' })
  @ApiResponse({ status: 200, description: 'Password verified successfully, returns longUrl.' })
  @ApiResponse({ status: 400, description: 'Invalid password.' })
  @ApiResponse({ status: 404, description: 'Short URL not found.' })
  async verifyPassword(
    @Param('code') code: string,
    @Body() verifyPasswordDto: VerifyPasswordDto,
  ) {
    return this.urlService.verifyPassword(code, verifyPasswordDto.password);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':code')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update short URL target or expiration (link owner only)' })
  @ApiParam({ name: 'code', description: 'Short code or custom alias' })
  @ApiResponse({ status: 200, description: 'Short URL updated successfully.' })
  @ApiResponse({ status: 403, description: 'Forbidden (not owner).' })
  @ApiResponse({ status: 404, description: 'Short URL not found.' })
  async updateUrl(
    @Param('code') code: string,
    @Body() updateUrlDto: UpdateUrlDto,
    @GetUser('userId') userId: string,
  ) {
    return this.urlService.updateUrl(code, updateUrlDto, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':code')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a short URL (link owner only)' })
  @ApiParam({ name: 'code', description: 'Short code or custom alias' })
  @ApiResponse({ status: 200, description: 'Short URL deleted successfully.' })
  @ApiResponse({ status: 403, description: 'Forbidden (not owner).' })
  @ApiResponse({ status: 404, description: 'Short URL not found.' })
  async deleteUrl(
    @Param('code') code: string,
    @GetUser('userId') userId: string,
  ) {
    return this.urlService.deleteUrl(code, userId);
  }
}
