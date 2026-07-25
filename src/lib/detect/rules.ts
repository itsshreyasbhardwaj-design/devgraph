import type { StackCategory } from '@/lib/core/types';

/**
 * Declarative stack-detection rules.
 *
 * A rule fires when any of its signals match. Signals are cheap and independent
 * so the detector stays a single pass over paths + dependency names. Adding
 * support for a new framework is a data change, not a code change.
 */
export interface StackRule {
  category: StackCategory;
  name: string;
  /** Dependency names in any ecosystem. Prefix-matched on `pkg/` boundaries. */
  dependencies?: string[];
  /** Basenames or repo-relative paths that must exist. */
  files?: string[];
  /** Directory names that must exist somewhere in the tree. */
  dirs?: string[];
  /** Path patterns matched against every file path. */
  pathPatterns?: RegExp[];
  /** Content pattern applied to files whose path matches `in`. */
  content?: { pattern: RegExp; in: RegExp };
  /** Base confidence when a single signal fires. */
  confidence?: number;
}

export const STACK_RULES: StackRule[] = [
  // ---------------------------------------------------------------- frameworks
  { category: 'framework', name: 'Next.js', dependencies: ['next'], files: ['next.config.js', 'next.config.ts', 'next.config.mjs'], confidence: 0.95 },
  { category: 'framework', name: 'React', dependencies: ['react'], confidence: 0.9 },
  { category: 'framework', name: 'Vue', dependencies: ['vue'], pathPatterns: [/\.vue$/], confidence: 0.9 },
  { category: 'framework', name: 'Nuxt', dependencies: ['nuxt'], files: ['nuxt.config.ts', 'nuxt.config.js'] },
  { category: 'framework', name: 'Angular', dependencies: ['@angular/core'], files: ['angular.json'] },
  { category: 'framework', name: 'Svelte', dependencies: ['svelte'], pathPatterns: [/\.svelte$/] },
  { category: 'framework', name: 'SvelteKit', dependencies: ['@sveltejs/kit'], files: ['svelte.config.js'] },
  { category: 'framework', name: 'Astro', dependencies: ['astro'], files: ['astro.config.mjs'] },
  { category: 'framework', name: 'Remix', dependencies: ['@remix-run/react', '@remix-run/node'] },
  { category: 'framework', name: 'SolidJS', dependencies: ['solid-js'] },
  { category: 'framework', name: 'Express', dependencies: ['express'] },
  { category: 'framework', name: 'Fastify', dependencies: ['fastify'] },
  { category: 'framework', name: 'NestJS', dependencies: ['@nestjs/core'], files: ['nest-cli.json'] },
  { category: 'framework', name: 'Koa', dependencies: ['koa'] },
  { category: 'framework', name: 'Hono', dependencies: ['hono'] },
  { category: 'framework', name: 'Electron', dependencies: ['electron'] },
  { category: 'framework', name: 'React Native', dependencies: ['react-native'], files: ['metro.config.js'] },
  { category: 'framework', name: 'Expo', dependencies: ['expo'], files: ['app.json', 'app.config.ts'] },
  { category: 'framework', name: 'Django', dependencies: ['django', 'Django'], files: ['manage.py'] },
  { category: 'framework', name: 'Flask', dependencies: ['flask', 'Flask'] },
  { category: 'framework', name: 'FastAPI', dependencies: ['fastapi'] },
  { category: 'framework', name: 'Celery', dependencies: ['celery'] },
  { category: 'framework', name: 'Ruby on Rails', dependencies: ['rails'], files: ['config/routes.rb'] },
  { category: 'framework', name: 'Laravel', dependencies: ['laravel/framework'], files: ['artisan'] },
  { category: 'framework', name: 'Symfony', dependencies: ['symfony/framework-bundle'] },
  { category: 'framework', name: 'Spring Boot', dependencies: ['org.springframework.boot:spring-boot-starter', 'org.springframework.boot:spring-boot-starter-web'], content: { pattern: /@SpringBootApplication/, in: /\.java$/ } },
  { category: 'framework', name: 'Quarkus', dependencies: ['io.quarkus:quarkus-core'] },
  { category: 'framework', name: 'ASP.NET Core', dependencies: ['Microsoft.AspNetCore.App'], content: { pattern: /WebApplication\.CreateBuilder|IApplicationBuilder/, in: /\.cs$/ } },
  { category: 'framework', name: 'Gin', dependencies: ['github.com/gin-gonic/gin'] },
  { category: 'framework', name: 'Echo', dependencies: ['github.com/labstack/echo'] },
  { category: 'framework', name: 'Fiber', dependencies: ['github.com/gofiber/fiber'] },
  { category: 'framework', name: 'Chi', dependencies: ['github.com/go-chi/chi'] },
  { category: 'framework', name: 'Actix Web', dependencies: ['actix-web'] },
  { category: 'framework', name: 'Axum', dependencies: ['axum'] },
  { category: 'framework', name: 'Rocket', dependencies: ['rocket'] },
  { category: 'framework', name: 'Tauri', dependencies: ['tauri', '@tauri-apps/api'] },

  // ------------------------------------------------------------------ runtimes
  { category: 'runtime', name: 'Node.js', files: ['package.json'], confidence: 0.7 },
  { category: 'runtime', name: 'Bun', files: ['bun.lockb', 'bunfig.toml', 'bun.lock'] },
  { category: 'runtime', name: 'Deno', files: ['deno.json', 'deno.jsonc', 'deno.lock'] },

  // ---------------------------------------------------------- package managers
  { category: 'package-manager', name: 'pnpm', files: ['pnpm-lock.yaml', 'pnpm-workspace.yaml'] },
  { category: 'package-manager', name: 'Yarn', files: ['yarn.lock', '.yarnrc.yml'] },
  { category: 'package-manager', name: 'npm', files: ['package-lock.json'] },
  { category: 'package-manager', name: 'Bun', files: ['bun.lockb', 'bun.lock'] },
  { category: 'package-manager', name: 'pip', files: ['requirements.txt'] },
  { category: 'package-manager', name: 'Poetry', files: ['poetry.lock'], content: { pattern: /\[tool\.poetry\]/, in: /pyproject\.toml$/ } },
  { category: 'package-manager', name: 'uv', files: ['uv.lock'] },
  { category: 'package-manager', name: 'Pipenv', files: ['Pipfile'] },
  { category: 'package-manager', name: 'Cargo', files: ['Cargo.toml'] },
  { category: 'package-manager', name: 'Go Modules', files: ['go.mod'] },
  { category: 'package-manager', name: 'Maven', files: ['pom.xml'] },
  { category: 'package-manager', name: 'Gradle', files: ['build.gradle', 'build.gradle.kts', 'settings.gradle'] },
  { category: 'package-manager', name: 'Composer', files: ['composer.json'] },
  { category: 'package-manager', name: 'Bundler', files: ['Gemfile'] },
  { category: 'package-manager', name: 'NuGet', files: ['packages.config', 'nuget.config'], pathPatterns: [/\.csproj$/] },

  // --------------------------------------------------------------- build tools
  { category: 'build-tool', name: 'Vite', dependencies: ['vite'], files: ['vite.config.ts', 'vite.config.js'] },
  { category: 'build-tool', name: 'Webpack', dependencies: ['webpack'], files: ['webpack.config.js'] },
  { category: 'build-tool', name: 'Rollup', dependencies: ['rollup'], files: ['rollup.config.js'] },
  { category: 'build-tool', name: 'esbuild', dependencies: ['esbuild'] },
  { category: 'build-tool', name: 'Parcel', dependencies: ['parcel'] },
  { category: 'build-tool', name: 'SWC', dependencies: ['@swc/core'], files: ['.swcrc'] },
  { category: 'build-tool', name: 'Babel', dependencies: ['@babel/core'], files: ['babel.config.js', '.babelrc'] },
  { category: 'build-tool', name: 'tsup', dependencies: ['tsup'] },
  { category: 'build-tool', name: 'TypeScript', dependencies: ['typescript'], files: ['tsconfig.json'] },
  { category: 'build-tool', name: 'Make', files: ['Makefile'] },
  { category: 'build-tool', name: 'Bazel', files: ['WORKSPACE', 'BUILD.bazel', 'MODULE.bazel'] },
  { category: 'build-tool', name: 'MSBuild', pathPatterns: [/\.sln$/, /\.csproj$/] },

  // ----------------------------------------------------------------- monorepo
  { category: 'monorepo', name: 'Turborepo', dependencies: ['turbo'], files: ['turbo.json'] },
  { category: 'monorepo', name: 'Nx', dependencies: ['nx'], files: ['nx.json'] },
  { category: 'monorepo', name: 'Lerna', dependencies: ['lerna'], files: ['lerna.json'] },
  { category: 'monorepo', name: 'pnpm workspaces', files: ['pnpm-workspace.yaml'] },
  { category: 'monorepo', name: 'Rush', files: ['rush.json'] },

  // ----------------------------------------------------------------- databases
  { category: 'database', name: 'PostgreSQL', dependencies: ['pg', 'postgres', 'psycopg2', 'psycopg2-binary', 'psycopg', 'asyncpg', 'github.com/lib/pq', 'github.com/jackc/pgx', 'Npgsql', 'org.postgresql:postgresql', 'sqlx'], content: { pattern: /postgres(ql)?:\/\/|provider\s*=\s*["']postgresql["']|\bPOSTGRES_(USER|DB|PASSWORD)\b/, in: /(\.env[\w.]*|\.prisma|compose\.ya?ml|docker-compose\.ya?ml|\.tf|\.ts|\.py|\.go)$/ } },
  { category: 'database', name: 'MySQL', dependencies: ['mysql', 'mysql2', 'pymysql', 'mysqlclient', 'github.com/go-sql-driver/mysql', 'MySql.Data', 'mysql:mysql-connector-java'], content: { pattern: /mysql:\/\/|provider\s*=\s*["']mysql["']/, in: /(\.env[\w.]*|\.prisma|compose\.ya?ml)$/ } },
  { category: 'database', name: 'SQLite', dependencies: ['sqlite3', 'better-sqlite3', 'aiosqlite', 'rusqlite', 'github.com/mattn/go-sqlite3'], pathPatterns: [/\.sqlite3?$/, /\.db$/], content: { pattern: /provider\s*=\s*["']sqlite["']/, in: /\.prisma$/ } },
  { category: 'database', name: 'MongoDB', dependencies: ['mongodb', 'mongoose', 'pymongo', 'motor', 'go.mongodb.org/mongo-driver', 'MongoDB.Driver'] },
  { category: 'database', name: 'Redis', dependencies: ['redis', 'ioredis', 'github.com/redis/go-redis', 'StackExchange.Redis', 'predis/predis'] },
  { category: 'database', name: 'Supabase', dependencies: ['@supabase/supabase-js', '@supabase/ssr', 'supabase'], dirs: ['supabase'] },
  { category: 'database', name: 'Firebase', dependencies: ['firebase', 'firebase-admin'], files: ['firebase.json'] },
  { category: 'database', name: 'DynamoDB', dependencies: ['@aws-sdk/client-dynamodb', 'aws-sdk', 'boto3'] },
  { category: 'database', name: 'Elasticsearch', dependencies: ['@elastic/elasticsearch', 'elasticsearch'] },
  { category: 'database', name: 'ClickHouse', dependencies: ['@clickhouse/client', 'clickhouse-driver'] },
  { category: 'database', name: 'Neo4j', dependencies: ['neo4j-driver'] },
  { category: 'database', name: 'PlanetScale', dependencies: ['@planetscale/database'] },
  { category: 'database', name: 'Neon', dependencies: ['@neondatabase/serverless'] },
  { category: 'database', name: 'Turso', dependencies: ['@libsql/client'] },

  // ---------------------------------------------------------------------- ORMs
  { category: 'orm', name: 'Prisma', dependencies: ['prisma', '@prisma/client'], pathPatterns: [/schema\.prisma$/] },
  { category: 'orm', name: 'Drizzle', dependencies: ['drizzle-orm'], files: ['drizzle.config.ts'] },
  { category: 'orm', name: 'TypeORM', dependencies: ['typeorm'] },
  { category: 'orm', name: 'Sequelize', dependencies: ['sequelize'] },
  { category: 'orm', name: 'Mongoose', dependencies: ['mongoose'] },
  { category: 'orm', name: 'Knex', dependencies: ['knex'] },
  { category: 'orm', name: 'Kysely', dependencies: ['kysely'] },
  { category: 'orm', name: 'SQLAlchemy', dependencies: ['sqlalchemy', 'SQLAlchemy'] },
  { category: 'orm', name: 'Django ORM', dependencies: ['django', 'Django'], content: { pattern: /models\.Model/, in: /\.py$/ } },
  { category: 'orm', name: 'Hibernate', dependencies: ['org.hibernate:hibernate-core'], content: { pattern: /@Entity/, in: /\.java$/ } },
  { category: 'orm', name: 'Entity Framework', dependencies: ['Microsoft.EntityFrameworkCore'], content: { pattern: /DbContext/, in: /\.cs$/ } },
  { category: 'orm', name: 'Eloquent', dependencies: ['laravel/framework'], content: { pattern: /extends\s+Model\b/, in: /\.php$/ } },
  { category: 'orm', name: 'GORM', dependencies: ['gorm.io/gorm'] },
  { category: 'orm', name: 'Diesel', dependencies: ['diesel'] },
  { category: 'orm', name: 'SeaORM', dependencies: ['sea-orm'] },
  { category: 'orm', name: 'ActiveRecord', dependencies: ['activerecord'] },

  // --------------------------------------------------------------- API styles
  { category: 'api-style', name: 'GraphQL', dependencies: ['graphql', 'apollo-server', '@apollo/server', 'graphene', 'strawberry-graphql', 'gqlgen'], pathPatterns: [/\.graphql$/, /\.gql$/] },
  { category: 'api-style', name: 'gRPC', dependencies: ['@grpc/grpc-js', 'grpcio', 'google.golang.org/grpc', 'Grpc.Net.Client', 'tonic'], pathPatterns: [/\.proto$/] },
  { category: 'api-style', name: 'tRPC', dependencies: ['@trpc/server', '@trpc/client'] },
  { category: 'api-style', name: 'WebSocket', dependencies: ['ws', 'socket.io', 'websockets', 'github.com/gorilla/websocket'] },
  { category: 'api-style', name: 'OpenAPI', files: ['openapi.yaml', 'openapi.json', 'swagger.yaml', 'swagger.json'], dependencies: ['swagger-ui-express', '@nestjs/swagger', 'drf-yasg', 'springdoc-openapi-starter-webmvc-ui'] },
  { category: 'api-style', name: 'REST', content: { pattern: /\b(app|router)\.(get|post|put|patch|delete)\(/, in: /\.(ts|js|py|go|rb|php)$/ }, confidence: 0.6 },

  // ------------------------------------------------------------------ testing
  { category: 'testing', name: 'Vitest', dependencies: ['vitest'], files: ['vitest.config.ts'] },
  { category: 'testing', name: 'Jest', dependencies: ['jest'], files: ['jest.config.js', 'jest.config.ts'] },
  { category: 'testing', name: 'Playwright', dependencies: ['@playwright/test', 'playwright'], files: ['playwright.config.ts'] },
  { category: 'testing', name: 'Cypress', dependencies: ['cypress'], files: ['cypress.config.ts'] },
  { category: 'testing', name: 'Testing Library', dependencies: ['@testing-library/react', '@testing-library/dom'] },
  { category: 'testing', name: 'Mocha', dependencies: ['mocha'] },
  { category: 'testing', name: 'pytest', dependencies: ['pytest'], files: ['pytest.ini', 'conftest.py'] },
  { category: 'testing', name: 'JUnit', dependencies: ['junit:junit', 'org.junit.jupiter:junit-jupiter'] },
  { category: 'testing', name: 'xUnit', dependencies: ['xunit'] },
  { category: 'testing', name: 'NUnit', dependencies: ['NUnit'] },
  { category: 'testing', name: 'PHPUnit', dependencies: ['phpunit/phpunit'] },
  { category: 'testing', name: 'RSpec', dependencies: ['rspec', 'rspec-rails'] },
  { category: 'testing', name: 'Go test', pathPatterns: [/_test\.go$/] },

  // -------------------------------------------------------------------- CI/CD
  { category: 'ci-cd', name: 'GitHub Actions', pathPatterns: [/^\.github\/workflows\/.+\.ya?ml$/] },
  { category: 'ci-cd', name: 'GitLab CI', files: ['.gitlab-ci.yml'] },
  { category: 'ci-cd', name: 'CircleCI', pathPatterns: [/^\.circleci\/config\.ya?ml$/] },
  { category: 'ci-cd', name: 'Travis CI', files: ['.travis.yml'] },
  { category: 'ci-cd', name: 'Jenkins', files: ['Jenkinsfile'] },
  { category: 'ci-cd', name: 'Azure Pipelines', files: ['azure-pipelines.yml'] },
  { category: 'ci-cd', name: 'Bitbucket Pipelines', files: ['bitbucket-pipelines.yml'] },
  { category: 'ci-cd', name: 'Drone', files: ['.drone.yml'] },
  { category: 'ci-cd', name: 'Buildkite', pathPatterns: [/^\.buildkite\//] },

  // --------------------------------------------------------- containerization
  { category: 'containerization', name: 'Docker', files: ['Dockerfile', '.dockerignore'], pathPatterns: [/Dockerfile(\..+)?$/] },
  { category: 'containerization', name: 'Docker Compose', files: ['docker-compose.yml', 'docker-compose.yaml', 'compose.yaml', 'compose.yml'] },
  { category: 'containerization', name: 'Kubernetes', dirs: ['k8s', 'kubernetes', 'manifests'], content: { pattern: /^apiVersion:\s*(apps|v1|batch)/m, in: /\.ya?ml$/ } },
  { category: 'containerization', name: 'Helm', files: ['Chart.yaml'], dirs: ['charts'] },

  // ----------------------------------------------------------------- deployment
  { category: 'deployment', name: 'Vercel', files: ['vercel.json', '.vercelignore'], dependencies: ['@vercel/analytics', '@vercel/speed-insights'] },
  { category: 'deployment', name: 'Netlify', files: ['netlify.toml'] },
  { category: 'deployment', name: 'Fly.io', files: ['fly.toml'] },
  { category: 'deployment', name: 'Railway', files: ['railway.json', 'railway.toml'] },
  { category: 'deployment', name: 'Render', files: ['render.yaml'] },
  { category: 'deployment', name: 'Heroku', files: ['Procfile', 'app.json'] },
  { category: 'deployment', name: 'Cloudflare Workers', files: ['wrangler.toml', 'wrangler.json', 'wrangler.jsonc'] },
  { category: 'deployment', name: 'Terraform', pathPatterns: [/\.tf$/] },
  { category: 'deployment', name: 'Pulumi', files: ['Pulumi.yaml'] },
  { category: 'deployment', name: 'AWS CDK', dependencies: ['aws-cdk-lib'], files: ['cdk.json'] },
  { category: 'deployment', name: 'Serverless Framework', files: ['serverless.yml', 'serverless.ts'] },
  { category: 'deployment', name: 'AWS SAM', files: ['template.yaml', 'samconfig.toml'] },

  // -------------------------------------------------------------------- styling
  { category: 'styling', name: 'Tailwind CSS', dependencies: ['tailwindcss'], files: ['tailwind.config.ts', 'tailwind.config.js'] },
  { category: 'styling', name: 'styled-components', dependencies: ['styled-components'] },
  { category: 'styling', name: 'Emotion', dependencies: ['@emotion/react', '@emotion/styled'] },
  { category: 'styling', name: 'Sass', dependencies: ['sass', 'node-sass'], pathPatterns: [/\.s[ac]ss$/] },
  { category: 'styling', name: 'CSS Modules', pathPatterns: [/\.module\.(css|scss|sass|less)$/] },
  { category: 'styling', name: 'Material UI', dependencies: ['@mui/material'] },
  { category: 'styling', name: 'Chakra UI', dependencies: ['@chakra-ui/react'] },
  { category: 'styling', name: 'shadcn/ui', files: ['components.json'], dependencies: ['class-variance-authority'] },
  { category: 'styling', name: 'Bootstrap', dependencies: ['bootstrap'] },

  // ----------------------------------------------------------- state management
  { category: 'state-management', name: 'Redux', dependencies: ['redux', '@reduxjs/toolkit'] },
  { category: 'state-management', name: 'Zustand', dependencies: ['zustand'] },
  { category: 'state-management', name: 'MobX', dependencies: ['mobx'] },
  { category: 'state-management', name: 'Jotai', dependencies: ['jotai'] },
  { category: 'state-management', name: 'Recoil', dependencies: ['recoil'] },
  { category: 'state-management', name: 'Pinia', dependencies: ['pinia'] },
  { category: 'state-management', name: 'Vuex', dependencies: ['vuex'] },
  { category: 'state-management', name: 'XState', dependencies: ['xstate'] },
  { category: 'state-management', name: 'TanStack Query', dependencies: ['@tanstack/react-query', 'react-query'] },
  { category: 'state-management', name: 'SWR', dependencies: ['swr'] },

  // -------------------------------------------------------------------- auth
  { category: 'auth', name: 'Clerk', dependencies: ['@clerk/nextjs', '@clerk/clerk-react', '@clerk/backend'] },
  { category: 'auth', name: 'Auth.js', dependencies: ['next-auth', '@auth/core'] },
  { category: 'auth', name: 'Auth0', dependencies: ['@auth0/nextjs-auth0', 'auth0'] },
  { category: 'auth', name: 'Supabase Auth', dependencies: ['@supabase/auth-helpers-nextjs', '@supabase/ssr'] },
  { category: 'auth', name: 'Firebase Auth', dependencies: ['firebase'], content: { pattern: /getAuth\(|signInWith/, in: /\.[jt]sx?$/ } },
  { category: 'auth', name: 'Passport', dependencies: ['passport'] },
  { category: 'auth', name: 'Lucia', dependencies: ['lucia'] },
  { category: 'auth', name: 'Better Auth', dependencies: ['better-auth'] },
  { category: 'auth', name: 'Django Auth', dependencies: ['django', 'Django'], content: { pattern: /django\.contrib\.auth/, in: /\.py$/ } },
  { category: 'auth', name: 'Spring Security', dependencies: ['org.springframework.boot:spring-boot-starter-security'] },
  { category: 'auth', name: 'ASP.NET Identity', dependencies: ['Microsoft.AspNetCore.Identity.EntityFrameworkCore'] },
  { category: 'auth', name: 'Devise', dependencies: ['devise'] },
  { category: 'auth', name: 'JWT', dependencies: ['jsonwebtoken', 'jose', 'pyjwt', 'PyJWT', 'github.com/golang-jwt/jwt', 'firebase/php-jwt'] },
];
