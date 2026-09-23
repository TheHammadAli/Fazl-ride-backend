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
  // Mobile apps do not need CORS (no browser origin), but the web admin
  // panel (fazl-parking-frontned) does. Comma-separated list; the local
  // panel's dev server is included by default so it works with no setup.
  const origins = String(
    process.env.ADMIN_PANEL_ORIGINS ?? 'http://localhost:3001',
  )
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins, credentials: true });
}
