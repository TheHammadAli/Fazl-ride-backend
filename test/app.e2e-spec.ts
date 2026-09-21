import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { setupApp } from '../src/setup-app.js';

// These cases never reach the database, so they run without Postgres.
describe('API surface (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    setupApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health responds', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);
    expect(['ok', 'degraded']).toContain(res.body.status);
  });

  it('rejects an invalid phone number', () =>
    request(app.getHttpServer())
      .post('/api/v1/auth/otp/request')
      .send({ phone: '12345' })
      .expect(400));

  it('rejects unknown body fields', () =>
    request(app.getHttpServer())
      .post('/api/v1/auth/otp/request')
      .send({ phone: '03001234567', role: 'admin' })
      .expect(400));

  it.each([
    '/api/v1/users/me',
    '/api/v1/drivers/me',
    '/api/v1/admin/users',
    '/api/v1/admin/api-keys',
    '/api/v1/integrations/ping',
    '/api/v1/drivers/me/status',
    '/api/v1/drivers/me/offers',
    '/api/v1/rides/active',
    '/api/v1/drivers/me/active-ride',
  ])('GET %s requires a token', (path) =>
    request(app.getHttpServer()).get(path).expect(401),
  );
});
