import { INestApplication } from '@nestjs/common';
import { HttpExceptionFilter } from './common/errors/http-exception.filter';

/** Configuración común de la app (la usan main.ts y las pruebas e2e). */
export function configureApp(app: INestApplication): INestApplication {
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();
  return app;
}
