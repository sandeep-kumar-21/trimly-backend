import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<UsersService>;
  let jwtService: jest.Mocked<JwtService>;

  beforeEach(async () => {
    const mockUsersService = {
      create: jest.fn(),
      findByEmail: jest.fn(),
    };
    const mockJwtService = {
      sign: jest.fn().mockReturnValue('mock_jwt_token'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    usersService = module.get(UsersService);
    jwtService = module.get(JwtService);
  });

  it('should register a new user and return token', async () => {
    const registerDto = { email: 'test@example.com', password: 'password123', name: 'Test User' };
    const mockUser = {
      _id: { toString: () => 'user123' },
      email: 'test@example.com',
      name: 'Test User',
      createdAt: new Date(),
    } as any;

    usersService.create.mockResolvedValue(mockUser);

    const result = await service.register(registerDto);

    expect(result.accessToken).toBe('mock_jwt_token');
    expect(result.user.email).toBe('test@example.com');
    expect(usersService.create).toHaveBeenCalled();
  });

  it('should throw UnauthorizedException on invalid login credentials', async () => {
    usersService.findByEmail.mockResolvedValue(null);

    await expect(service.login({ email: 'wrong@example.com', password: 'pass' })).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
