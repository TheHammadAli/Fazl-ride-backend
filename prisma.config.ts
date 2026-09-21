import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // Migrations use the direct connection; the app uses DATABASE_URL (pooled).
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '',
  },
});
