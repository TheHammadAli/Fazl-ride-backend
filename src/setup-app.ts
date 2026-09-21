import { INestApplication, ValidationPipe } from '@nestjs/common';

// Shared by main.ts and the e2e tests so both run with the same pipeline.
export function setupApp(app: INestApplication) {
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}
