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

    const result = await this.redirectService.getLongUrlAndLogClick(
      code,
      clientIp,
      referrer,
      userAgent,
    );

    if (typeof result === 'object' && result.passwordProtected) {
      return res.redirect(302, result.redirectUrl);
    }

    return res.redirect(302, result as string);
  }
}
