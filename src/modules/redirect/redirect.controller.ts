import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { RedirectService } from './redirect.service';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('Redirect')
@Controller('r')
export class RedirectController {
  constructor(private readonly redirectService: RedirectService) {}

  @Public()
  @Get(':code')
  @ApiOperation({ summary: 'Redirect short code to original long URL (302 Found)' })
  @ApiParam({ name: 'code', description: 'Short URL code' })
  @ApiResponse({ status: 302, description: 'Redirecting to target URL.' })
  @ApiResponse({ status: 404, description: 'Short code not found or expired.' })
  async handleRedirect(
    @Param('code') code: string,
    @Req() req: any,
    @Res() res: any,
  ) {
    const xForwardedFor = req.headers['x-forwarded-for'] as string;
    const clientIp = xForwardedFor
      ? xForwardedFor.split(',')[0].trim()
      : req.socket.remoteAddress || '127.0.0.1';
    const referrer = req.get('referer') || req.get('referrer') || null;
    const userAgent = req.get('user-agent') || null;
    const isQrScan = req.query?.qr === '1' || req.query?.scan === '1' || req.query?.source === 'qr';
    const utms = {
      utmSource: req.query?.utm_source || null,
      utmMedium: req.query?.utm_medium || null,
      utmCampaign: req.query?.utm_campaign || null,
      utmTerm: req.query?.utm_term || null,
      utmContent: req.query?.utm_content || null,
    };

    const result = await this.redirectService.getLongUrlAndLogClick(
      code,
      clientIp,
      referrer,
      userAgent,
      isQrScan,
      utms,
    );

    if (typeof result === 'object' && result.passwordProtected) {
      return res.redirect(302, result.redirectUrl);
    }

    return res.redirect(302, result as string);
  }
}
