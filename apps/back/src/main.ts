import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { cleanupOpenApiDoc, createZodValidationPipe } from 'nestjs-zod';
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

  // OpenAPI / Swagger en `/api/docs`. Los DTOs creados con
  // `createZodDto()` se exponen automáticamente; `cleanupOpenApiDoc`
  // de nestjs-zod resuelve los `$ref` que el SDK Zod genera para que
  // el doc final quede consumible por clientes OpenAPI estándar.
  if (config.get('SWAGGER_ENABLED', { infer: true })) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Tikora API')
      .setDescription('API de la plataforma de gestión de tickets con IA.')
      .setVersion('1')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
      .build();
    const document = cleanupOpenApiDoc(SwaggerModule.createDocument(app, swaggerConfig));
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  const port = config.get('PORT', { infer: true });
  await app.listen(port);

  Logger.log(`🚀 Tikora backend corriendo en http://localhost:${port}/api/v1`, 'Bootstrap');
  if (config.get('SWAGGER_ENABLED', { infer: true })) {
    Logger.log(`📚 Swagger disponible en http://localhost:${port}/api/docs`, 'Bootstrap');
  }
}

bootstrap().catch((err) => {
  Logger.error(err instanceof Error ? err.stack : String(err), 'Bootstrap');
  process.exit(1);
});
