import {
  Controller,
  Post,
  Get,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Res,
  HttpCode,
  HttpStatus,
  Header,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import type { Response } from 'express';
import { QrCodesService } from './qrcodes.service';
import { CreateQrCodeDto } from './dto/create-qrcode.dto';
import { UpdateQrCodeDto } from './dto/update-qrcode.dto';
import { DuplicateQrCodeDto } from './dto/duplicate-qrcode.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';

@ApiTags('QR Codes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('qrcodes')
export class QrCodesController {
  constructor(private readonly qrCodesService: QrCodesService) {}

  @Post()
  @ApiOperation({ summary: 'Generate and save a customized QR code for owned short URL' })
  @ApiResponse({ status: 201, description: 'QR code generated and saved.' })
  @ApiResponse({ status: 403, description: 'Forbidden (not link owner).' })
  @ApiResponse({ status: 404, description: 'Short URL not found.' })
  async createQrCode(
    @Body() createQrCodeDto: CreateQrCodeDto,
    @GetUser('userId') userId: string,
  ) {
    return this.qrCodesService.createQrCode(createQrCodeDto, userId);
  }

  @Get()
  @ApiOperation({ summary: 'Get all saved QR codes for the authenticated user' })
  @ApiResponse({ status: 200, description: 'Returns list of user QR code configurations.' })
  async getUserQrCodes(
    @GetUser('userId') userId: string,
    @Query('qrExpiration') qrExpiration?: 'all' | 'expired' | 'expiring' | 'none',
    @Query('linkAttachment') linkAttachment?: 'all' | 'with' | 'without',
  ) {
    return this.qrCodesService.getUserQrCodes(userId, {
      qrExpiration,
      linkAttachment,
    });
  }

  @Get(':code/details')
  @ApiOperation({ summary: 'Get single QR code details and metadata' })
  @ApiParam({ name: 'code', description: 'Short URL code' })
  @ApiResponse({ status: 200, description: 'Returns QR code configuration and linked URL details.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'QR Code not found.' })
  async getQrCodeDetails(
    @Param('code') code: string,
    @GetUser('userId') userId: string,
  ) {
    return this.qrCodesService.getQrCodeByCode(code, userId);
  }

  @Get(':code')
  @ApiOperation({ summary: 'Fetch QR code image for a short code (SVG by default, PNG on demand)' })
  @ApiParam({ name: 'code', description: 'Short URL code' })
  @ApiResponse({ status: 200, description: 'Returns SVG (default) or PNG image of rendered QR code.' })
  @ApiResponse({ status: 403, description: 'Forbidden (not link owner).' })
  @ApiResponse({ status: 404, description: 'Short URL not found.' })
  async getQrCodeImage(
    @Param('code') code: string,
    @Query('format') format: 'svg' | 'png' = 'svg',
    @GetUser('userId') userId: string,
    @Res() res: Response,
  ) {
    const validFormat = format === 'png' ? 'png' : 'svg';
    const { buffer, fromCache, contentType } = await this.qrCodesService.getQrCodeImage(code, userId, validFormat);
    res.setHeader('X-Cache', fromCache ? 'HIT' : 'MISS');
    return res.type(contentType).send(buffer);
  }

  @Delete(':code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a saved QR code configuration' })
  @ApiParam({ name: 'code', description: 'Short URL code' })
  @ApiResponse({ status: 200, description: 'QR code configuration deleted.' })
  @ApiResponse({ status: 404, description: 'QR Code not found.' })
  async deleteQrCode(
    @Param('code') code: string,
    @GetUser('userId') userId: string,
  ) {
    return this.qrCodesService.deleteQrCode(code, userId);
  }

  @Post(':code/duplicate')
  @ApiOperation({ summary: 'Duplicate a QR code design to another short URL' })
  @ApiParam({ name: 'code', description: 'Source Short URL code' })
  @ApiResponse({ status: 201, description: 'QR code duplicated.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Not found.' })
  async duplicateQrCode(
    @Param('code') code: string,
    @Body() duplicateDto: DuplicateQrCodeDto,
    @GetUser('userId') userId: string,
  ) {
    return this.qrCodesService.duplicateQrCode(code, duplicateDto.targetShortCode, userId);
  }

  @Patch(':code')
  @ApiOperation({ summary: 'Update a QR code configuration (e.g. visibility)' })
  @ApiParam({ name: 'code', description: 'Short URL code' })
  @ApiResponse({ status: 200, description: 'QR code updated.' })
  async updateQrCode(
    @Param('code') code: string,
    @Body() updateDto: UpdateQrCodeDto,
    @GetUser('userId') userId: string,
  ) {
    return this.qrCodesService.updateQrCode(code, updateDto, userId);
  }
}
