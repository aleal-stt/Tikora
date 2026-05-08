import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { createZodValidationPipe } from 'nestjs-zod';
import { AppModule } from './app/app.module';
import { createZodValidationException } from './common/validation/zod-validation.factory';
import { Env } from './config/env.schema';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService<Env, true>);

  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    credentials: true,
  });
  // Pipe Zod global con shape de error alineado a `tikora-api.md` §1
  // (`{statusCode, code, message, details}`). Sin esto, nestjs-zod
  // devuelve `{statusCode, message, errors[]}` que rompe el manejo de
  // errores unificado del front.
  const TikoraZodValidationPipe = createZodValidationPipe({
    createValidationException: createZodValidationException,
  });
  app.useGlobalPipes(new TikoraZodValidationPipe());

  const port = config.get('PORT', { infer: true });
  await app.listen(port);

  Logger.log(`🚀 Tikora backend corriendo en http://localhost:${port}/api/v1`, 'Bootstrap');
}

bootstrap().catch((err) => {
  Logger.error(err instanceof Error ? err.stack : String(err), 'Bootstrap');
  process.exit(1);
});
