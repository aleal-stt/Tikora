import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { AreasController } from './controllers/areas.controller';
import { Area, AreaSchema } from './schemas/area.schema';
import { AreasService } from './services/areas.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Area.name, schema: AreaSchema }]),
    // forwardRef rompe el ciclo: UsersModule también nos importa para
    // tener acceso al modelo Area al sincronizar membership.
    forwardRef(() => UsersModule),
  ],
  controllers: [AreasController],
  providers: [AreasService],
  // Exportamos `MongooseModule` para que `UsersModule` reciba el modelo Area
  // vía `@InjectModel(Area.name)` sin pegarle al service directamente.
  exports: [AreasService, MongooseModule],
})
export class AreasModule {}
