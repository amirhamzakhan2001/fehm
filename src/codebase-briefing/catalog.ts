/**
 * What well-known dependencies are for. A catalog hit only explains a
 * dependency; whether it is actually used is decided by graph evidence
 * (an `imports` edge to the package), never by the catalog.
 */
export type TechCategory =
  | "web-framework"
  | "frontend"
  | "database"
  | "orm"
  | "cache"
  | "queue"
  | "ai"
  | "payments"
  | "auth"
  | "email"
  | "sms"
  | "storage"
  | "cloud"
  | "observability"
  | "validation"
  | "testing"
  | "build"
  | "cli"
  | "parsing"
  | "graphics"
  | "http-client"
  | "ml"
  | "scheduler"
  | "security";

export interface TechInfo {
  label: string;
  category: TechCategory;
  purpose: string;
  /** External network service (vs. an in-process library). */
  service?: boolean;
}

const T = (label: string, category: TechCategory, purpose: string, service = false): TechInfo => ({ label, category, purpose, ...(service ? { service } : {}) });

const EXACT: Record<string, TechInfo> = {
  express: T("Express", "web-framework", "HTTP routing and middleware"),
  fastify: T("Fastify", "web-framework", "HTTP server framework"),
  koa: T("Koa", "web-framework", "HTTP middleware framework"),
  hono: T("Hono", "web-framework", "HTTP routing framework"),
  "@nestjs/core": T("NestJS", "web-framework", "Structured server framework (controllers/modules)"),
  next: T("Next.js", "frontend", "React framework with server rendering and routes"),
  react: T("React", "frontend", "UI component rendering"),
  "react-dom": T("React DOM", "frontend", "React browser renderer"),
  vue: T("Vue", "frontend", "UI component rendering"),
  svelte: T("Svelte", "frontend", "Compiled UI components"),
  "@angular/core": T("Angular", "frontend", "UI application framework"),
  three: T("three.js", "graphics", "WebGL 3D/2D rendering"),
  d3: T("D3", "graphics", "Data visualization"),
  pg: T("PostgreSQL client (pg)", "database", "PostgreSQL access"),
  postgres: T("postgres.js", "database", "PostgreSQL access"),
  mysql: T("MySQL client", "database", "MySQL access"),
  mysql2: T("MySQL client (mysql2)", "database", "MySQL access"),
  sqlite3: T("SQLite", "database", "Embedded SQL database"),
  "better-sqlite3": T("SQLite (better-sqlite3)", "database", "Embedded SQL database"),
  mongodb: T("MongoDB driver", "database", "MongoDB access"),
  mongoose: T("Mongoose", "orm", "MongoDB object modelling"),
  "@prisma/client": T("Prisma", "orm", "Typed database client generated from schema.prisma"),
  prisma: T("Prisma CLI", "orm", "Schema migrations and client generation"),
  typeorm: T("TypeORM", "orm", "Entity-based ORM"),
  sequelize: T("Sequelize", "orm", "SQL ORM"),
  "drizzle-orm": T("Drizzle", "orm", "Typed SQL query builder"),
  knex: T("Knex", "orm", "SQL query builder and migrations"),
  redis: T("Redis client", "cache", "Redis cache / data store", true),
  ioredis: T("ioredis", "cache", "Redis cache / data store", true),
  bullmq: T("BullMQ", "queue", "Redis-backed job queue", true),
  bull: T("Bull", "queue", "Redis-backed job queue", true),
  amqplib: T("RabbitMQ (amqplib)", "queue", "AMQP message broker client", true),
  kafkajs: T("Kafka (kafkajs)", "queue", "Kafka producer/consumer", true),
  openai: T("OpenAI", "ai", "LLM / embedding API", true),
  "@anthropic-ai/sdk": T("Anthropic", "ai", "Claude LLM API", true),
  ai: T("Vercel AI SDK", "ai", "LLM provider abstraction", true),
  langchain: T("LangChain", "ai", "LLM orchestration"),
  stripe: T("Stripe", "payments", "Payment processing", true),
  jsonwebtoken: T("jsonwebtoken", "auth", "JWT signing/verification"),
  jose: T("jose", "auth", "JWT / JOSE primitives"),
  passport: T("Passport", "auth", "Authentication strategies"),
  bcrypt: T("bcrypt", "auth", "Password hashing"),
  bcryptjs: T("bcryptjs", "auth", "Password hashing"),
  argon2: T("argon2", "auth", "Password hashing"),
  "next-auth": T("NextAuth", "auth", "Session authentication", true),
  "@clerk/nextjs": T("Clerk", "auth", "Hosted authentication", true),
  "firebase-admin": T("Firebase Admin", "cloud", "Firebase services", true),
  firebase: T("Firebase", "cloud", "Firebase services", true),
  "@supabase/supabase-js": T("Supabase", "database", "Hosted Postgres + auth", true),
  nodemailer: T("Nodemailer", "email", "Outbound email", true),
  "@sendgrid/mail": T("SendGrid", "email", "Transactional email", true),
  twilio: T("Twilio", "sms", "SMS / voice", true),
  "aws-sdk": T("AWS SDK", "cloud", "AWS service access", true),
  "@google-cloud/storage": T("Google Cloud Storage", "storage", "Object storage", true),
  "@sentry/node": T("Sentry", "observability", "Error reporting", true),
  winston: T("winston", "observability", "Logging"),
  pino: T("pino", "observability", "Logging"),
  zod: T("Zod", "validation", "Runtime schema validation"),
  joi: T("Joi", "validation", "Runtime schema validation"),
  yup: T("Yup", "validation", "Runtime schema validation"),
  "class-validator": T("class-validator", "validation", "Decorator-based validation"),
  helmet: T("Helmet", "security", "HTTP security headers"),
  cors: T("cors", "security", "Cross-origin resource sharing policy"),
  axios: T("axios", "http-client", "Outbound HTTP"),
  "node-fetch": T("node-fetch", "http-client", "Outbound HTTP"),
  commander: T("Commander", "cli", "Command-line argument parsing"),
  yargs: T("yargs", "cli", "Command-line argument parsing"),
  "node-cron": T("node-cron", "scheduler", "In-process scheduled jobs"),
  typescript: T("TypeScript", "parsing", "Type checking / compiler API"),
  "tree-sitter": T("Tree-sitter", "parsing", "Incremental source parsing"),
  "@babel/parser": T("Babel parser", "parsing", "JavaScript parsing"),
  vitest: T("Vitest", "testing", "Unit test runner"),
  jest: T("Jest", "testing", "Unit test runner"),
  mocha: T("Mocha", "testing", "Test runner"),
  "@playwright/test": T("Playwright", "testing", "End-to-end browser tests"),
  cypress: T("Cypress", "testing", "End-to-end browser tests"),
  supertest: T("supertest", "testing", "HTTP integration tests"),
  tsx: T("tsx", "build", "Run TypeScript directly (dev/test)"),
  vite: T("Vite", "build", "Frontend dev server and bundler"),
  webpack: T("webpack", "build", "Bundler"),
  esbuild: T("esbuild", "build", "Bundler / transpiler"),
  eslint: T("ESLint", "build", "Linting"),
  prettier: T("Prettier", "build", "Formatting"),
  // Python
  django: T("Django", "web-framework", "Web framework with ORM and admin"),
  flask: T("Flask", "web-framework", "HTTP micro-framework"),
  fastapi: T("FastAPI", "web-framework", "Typed HTTP API framework"),
  starlette: T("Starlette", "web-framework", "ASGI framework"),
  uvicorn: T("Uvicorn", "web-framework", "ASGI server"),
  gunicorn: T("Gunicorn", "web-framework", "WSGI server"),
  sqlalchemy: T("SQLAlchemy", "orm", "SQL toolkit and ORM"),
  alembic: T("Alembic", "orm", "Database migrations"),
  psycopg2: T("psycopg2", "database", "PostgreSQL access"),
  pymongo: T("PyMongo", "database", "MongoDB access"),
  celery: T("Celery", "queue", "Distributed task queue", true),
  pydantic: T("Pydantic", "validation", "Typed data validation"),
  requests: T("requests", "http-client", "Outbound HTTP"),
  httpx: T("httpx", "http-client", "Outbound HTTP"),
  boto3: T("boto3 (AWS)", "cloud", "AWS service access", true),
  torch: T("PyTorch", "ml", "Model training / inference"),
  tensorflow: T("TensorFlow", "ml", "Model training / inference"),
  sklearn: T("scikit-learn", "ml", "Classical ML"),
  "scikit-learn": T("scikit-learn", "ml", "Classical ML"),
  transformers: T("Hugging Face Transformers", "ml", "Pretrained models"),
  numpy: T("NumPy", "ml", "Numerical arrays"),
  pandas: T("pandas", "ml", "Tabular data processing"),
  pytest: T("pytest", "testing", "Test runner"),
  click: T("Click", "cli", "Command-line interface"),
  typer: T("Typer", "cli", "Command-line interface"),
  argparse: T("argparse", "cli", "Command-line argument parsing"),
  // Go
  "github.com/gin-gonic/gin": T("Gin", "web-framework", "HTTP framework"),
  "github.com/labstack/echo/v4": T("Echo", "web-framework", "HTTP framework"),
  "github.com/spf13/cobra": T("Cobra", "cli", "Command-line interface"),
  "gorm.io/gorm": T("GORM", "orm", "Go ORM"),
  "net/http": T("net/http", "web-framework", "Go standard HTTP server/client"),
  "database/sql": T("database/sql", "database", "Go SQL interface"),
};

const PREFIX: [string, TechInfo][] = [
  ["@aws-sdk/", T("AWS SDK v3", "cloud", "AWS service access", true)],
  ["@google-cloud/", T("Google Cloud SDK", "cloud", "Google Cloud service access", true)],
  ["@azure/", T("Azure SDK", "cloud", "Azure service access", true)],
  ["@opentelemetry/", T("OpenTelemetry", "observability", "Tracing / metrics")],
  ["@sentry/", T("Sentry", "observability", "Error reporting", true)],
  ["@types/", T("Type definitions", "build", "TypeScript type declarations")],
  ["@radix-ui/", T("Radix UI", "frontend", "Accessible UI primitives")],
  ["@tanstack/", T("TanStack", "frontend", "Client data/state utilities")],
];

/** Node built-ins that matter for runtime/security/persistence orientation. */
const NODE_BUILTINS = new Set([
  "fs", "path", "http", "https", "net", "crypto", "child_process", "os", "url", "util", "stream", "events", "worker_threads",
  "cluster", "zlib", "readline", "module", "assert", "test", "process", "buffer", "timers", "dns", "tls", "vm", "perf_hooks",
]);

export function normalizePackage(name: string): string {
  return name.startsWith("node:") ? name : NODE_BUILTINS.has(name.split("/")[0]!) ? `node:${name}` : name;
}

export function isBuiltin(name: string): boolean {
  return normalizePackage(name).startsWith("node:");
}

export function techInfo(name: string): TechInfo | undefined {
  const n = name.toLowerCase();
  if (EXACT[n]) return EXACT[n];
  for (const [prefix, info] of PREFIX) if (n.startsWith(prefix)) return info;
  return undefined;
}

export const CATEGORY_LABEL: Record<TechCategory, string> = {
  "web-framework": "Web / HTTP",
  frontend: "Frontend",
  database: "Database",
  orm: "ORM / data access",
  cache: "Cache",
  queue: "Queues / jobs",
  ai: "AI / LLM",
  payments: "Payments",
  auth: "Authentication",
  email: "Email",
  sms: "SMS",
  storage: "Object storage",
  cloud: "Cloud SDK",
  observability: "Observability",
  validation: "Validation",
  testing: "Testing",
  build: "Build / tooling",
  cli: "CLI",
  parsing: "Parsing / compilers",
  graphics: "Graphics",
  "http-client": "Outbound HTTP",
  ml: "Machine learning",
  scheduler: "Scheduling",
  security: "Security middleware",
};
