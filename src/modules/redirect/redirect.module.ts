import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { UrlModule } from '../url/url.module';
import { QueueModule } from '../queue/queue.module';
import { RedirectService } from './redirect.service';
import { RedirectController } from './redirect.controller';

@Module({
  imports: [ConfigModule, UrlModule, QueueModule.register()],
  providers: [RedirectService],
  controllers: [RedirectController],
  exports: [RedirectService],
})
export class RedirectModule {}
