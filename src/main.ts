import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import type { Env } from './config/env.schema';

async function bootstrap(): Promise<void> {
  const app = configureApp(await NestFactory.create(AppModule));
  const port = app.get(ConfigService<Env, true>).get('PORT', { infer: true });
  await app.listen(port);
  new Logger('Bootstrap').log(`Servicio de validaciones escuchando en el puerto ${port}`);
}

void bootstrap();
