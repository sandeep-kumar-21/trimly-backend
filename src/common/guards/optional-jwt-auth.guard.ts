import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest(err: any, user: any) {
    // If there's an error or no user, just return null/undefined instead of throwing UnauthorizedException
    if (err || !user) {
      return null;
    }
    return user;
  }
}
