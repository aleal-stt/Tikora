import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmailModule } from '../email/email.module';
import { UsersController } from './controllers/users.controller';
import { User, UserSchema } from './schemas/user.schema';
import { PasswordService } from './services/password.service';
import { UsersService } from './services/users.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]), EmailModule],
  controllers: [UsersController],
  providers: [UsersService, PasswordService],
  // Exportamos `PasswordService` porque AuthModule (que importa UsersModule)
  // lo necesita para validar credenciales — evita el ciclo que se daría si
  // el service viviera en AuthModule.
  exports: [UsersService, PasswordService, MongooseModule],
})
export class UsersModule {}
