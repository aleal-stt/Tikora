import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import type { Env } from '../../config/env.schema';

@Injectable()
export class PasswordService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  hash(plain: string): Promise<string> {
    const rounds = this.config.get('BCRYPT_SALT_ROUNDS', { infer: true });
    return bcrypt.hash(plain, rounds);
  }

  compare(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }
}
