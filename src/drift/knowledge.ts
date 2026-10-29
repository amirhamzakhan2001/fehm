import type { Practice, ProjectType } from "./types.js";

/**
 * Framework conventions and industry practices (spec §4.1, §4.2, §29).
 * Every statement is phrased as commonly observed practice, never as a
 * requirement. Each links to the project-pattern kind that measures it
 * (`measuredBy`), so a finding can say: "the project does X in 38 of 42
 * cases; NestJS projects commonly do X; layered backends commonly do X".
 *
 * Industry practices only apply to the project types they make sense for:
 * a research notebook repository is not a layered backend.
 */

// Repository packaging alone does not establish a server deployment.
const BACKEND: ProjectType[] = ["backend-service", "microservice"];
const SERVER: ProjectType[] = [...BACKEND, "data-pipeline"];
const APPS: ProjectType[] = [...BACKEND, "web-application", "mobile"];
const CODEBASES: ProjectType[] = [...APPS, "cli", "library", "data-pipeline", "ml-project", "game", "infrastructure"];

interface IndustryPractice extends Practice {
  appliesTo: ProjectType[];
}

export const INDUSTRY: IndustryPractice[] = [
  { id: "IND-DELEGATE", source: "industry", title: "Entry points delegate", statement: "Request handlers commonly delegate to service code instead of reaching persistence or third-party services directly.", category: "api", measuredBy: "dependency", appliesTo: APPS },
  { id: "IND-DB-BOUNDARY", source: "industry", title: "Persistence boundary", statement: "Database access is commonly concentrated behind a data-access boundary (repositories, models, a data layer).", category: "database", measuredBy: "db-access", appliesTo: SERVER },
  { id: "IND-EXTERNAL-BOUNDARY", source: "industry", title: "External service boundary", statement: "Third-party services are commonly reached through a client, adapter or service rather than from many places.", category: "external-service", measuredBy: "sdk-access", appliesTo: APPS },
  { id: "IND-THIN-HANDLERS", source: "industry", title: "Thin route handlers", statement: "Route handlers commonly stay small and hand work to other code.", category: "api", measuredBy: "api-handler", appliesTo: BACKEND },
  { id: "IND-CONFIG", source: "industry", title: "Centralised configuration", statement: "Configuration is commonly read in one place and passed in, not read or hard-coded throughout the code.", category: "configuration", measuredBy: "config", appliesTo: CODEBASES },
  { id: "IND-LOGGING", source: "industry", title: "One logging mechanism", statement: "Server code commonly logs through one mechanism, so output can be filtered, shipped and correlated.", category: "observability", measuredBy: "logging", appliesTo: SERVER },
  { id: "IND-ERRORS", source: "industry", title: "Central error handling", statement: "Web backends commonly translate errors to responses in one central place.", category: "error-handling", measuredBy: "errors", appliesTo: BACKEND },
  { id: "IND-NO-CYCLES", source: "industry", title: "Acyclic module dependencies", statement: "Modules commonly depend on each other in one direction, so each can change and be tested on its own.", category: "cycle", measuredBy: "cycles", appliesTo: CODEBASES },
  { id: "IND-TESTS", source: "industry", title: "Consistent test organisation", statement: "Production modules commonly have tests in one consistent place.", category: "testing", measuredBy: "tests", appliesTo: CODEBASES },
  { id: "IND-DI", source: "industry", title: "Dependency injection", statement: "Services commonly receive their collaborators rather than constructing them, which keeps them replaceable in tests.", category: "dependency-injection", measuredBy: "di", appliesTo: BACKEND },
  { id: "IND-AUTH", source: "industry", title: "Consistent authentication boundary", statement: "Routes commonly pass through one authentication mechanism (middleware, guards, dependencies).", category: "security-boundary", measuredBy: "auth", appliesTo: BACKEND },
  { id: "IND-MODULE-API", source: "industry", title: "Modules used through their entry point", statement: "Modules with a public entry point (index, __init__, mod) are commonly used through it, not through their internals.", category: "module-boundary", measuredBy: "module-api", appliesTo: CODEBASES },
  { id: "IND-FOCUSED-UNITS", source: "industry", title: "Focused units", statement: "A unit commonly has a small number of responsibilities.", category: "responsibility", measuredBy: "responsibility", appliesTo: CODEBASES },
  { id: "IND-WORKSPACES", source: "industry", title: "Share through packages", statement: "In monorepos, applications commonly share code through packages rather than importing each other.", category: "monorepo", measuredBy: "monorepo", appliesTo: ["monorepo"] },
  { id: "IND-ASSETS", source: "industry", title: "Dedicated asset directories", statement: "Static assets are commonly kept in dedicated asset directories.", category: "file-placement", measuredBy: "assets", appliesTo: ["web-application", "mobile", "game"] },
];

/** Framework conventions, keyed by the framework ids of `context.ts`. */
export const FRAMEWORK: Practice[] = [
  { id: "FW-EXPRESS-DELEGATE", source: "framework", framework: "express", title: "Routes delegate to services", statement: "Express projects commonly keep route handlers thin and put persistence in service or data modules.", category: "api", measuredBy: "dependency" },
  { id: "FW-EXPRESS-ERRORS", source: "framework", framework: "express", title: "Error middleware", statement: "Express projects commonly handle errors in an error-handling middleware `(err, req, res, next)`.", category: "error-handling", measuredBy: "errors" },
  { id: "FW-FASTIFY-DELEGATE", source: "framework", framework: "fastify", title: "Routes delegate to services", statement: "Fastify projects commonly register routes that delegate to services or plugins.", category: "api", measuredBy: "dependency" },
  { id: "FW-FASTIFY-ERRORS", source: "framework", framework: "fastify", title: "setErrorHandler", statement: "Fastify projects commonly centralise error responses with `setErrorHandler`.", category: "error-handling", measuredBy: "errors" },
  { id: "FW-KOA-DELEGATE", source: "framework", framework: "koa", title: "Routes delegate", statement: "Koa projects commonly keep middleware and routes thin and delegate to services.", category: "api", measuredBy: "dependency" },
  { id: "FW-NEST-LAYERS", source: "framework", framework: "nestjs", title: "Controller → Service → Repository", statement: "NestJS projects commonly follow Controller → Service (provider) → Repository; controllers do not access persistence.", category: "api", measuredBy: "dependency" },
  { id: "FW-NEST-DB", source: "framework", framework: "nestjs", title: "Repositories / providers own persistence", statement: "NestJS projects commonly access the database through injected repositories or providers.", category: "database", measuredBy: "db-access" },
  { id: "FW-NEST-DI", source: "framework", framework: "nestjs", title: "Constructor injection", statement: "NestJS providers are commonly injected through constructors, not instantiated with `new`.", category: "dependency-injection", measuredBy: "di" },
  { id: "FW-NEST-ERRORS", source: "framework", framework: "nestjs", title: "Exception filters", statement: "NestJS projects commonly centralise error responses in exception filters.", category: "error-handling", measuredBy: "errors" },
  { id: "FW-NEST-AUTH", source: "framework", framework: "nestjs", title: "Guards", statement: "NestJS projects commonly protect routes with guards.", category: "security-boundary", measuredBy: "auth" },
  { id: "FW-NEXT-DB", source: "framework", framework: "nextjs", title: "Data access on the server boundary", statement: "Next.js projects commonly keep database access in server code (route handlers, server actions, data modules), not in UI components.", category: "database", measuredBy: "db-access" },
  { id: "FW-REACT-DATA", source: "framework", framework: "react", title: "Components get data through hooks or services", statement: "React projects commonly fetch data through hooks or service modules rather than inside many components.", category: "external-service", measuredBy: "sdk-access" },
  { id: "FW-ANGULAR-DI", source: "framework", framework: "angular", title: "Injected services", statement: "Angular projects commonly inject services into components through the constructor or `inject()`.", category: "dependency-injection", measuredBy: "di" },
  { id: "FW-VUE-DATA", source: "framework", framework: "vue", title: "Composables / services for data", statement: "Vue projects commonly fetch data through composables or service modules.", category: "external-service", measuredBy: "sdk-access" },
  { id: "FW-DJANGO-ORM", source: "framework", framework: "django", title: "ORM through models", statement: "Django projects commonly query through models and managers; views rarely run raw SQL.", category: "database", measuredBy: "db-access" },
  { id: "FW-DJANGO-SETTINGS", source: "framework", framework: "django", title: "settings.py", statement: "Django projects commonly read configuration in settings and use `django.conf.settings` elsewhere.", category: "configuration", measuredBy: "config" },
  { id: "FW-DJANGO-TESTS", source: "framework", framework: "django", title: "Per-app tests", statement: "Django apps commonly keep tests in `tests.py` or a `tests/` package inside each app.", category: "testing", measuredBy: "tests" },
  { id: "FW-FLASK-BLUEPRINTS", source: "framework", framework: "flask", title: "Blueprints delegate", statement: "Flask projects commonly group routes in blueprints that delegate to services or models.", category: "api", measuredBy: "dependency" },
  { id: "FW-FLASK-ERRORS", source: "framework", framework: "flask", title: "errorhandler", statement: "Flask projects commonly register central error handlers with `@app.errorhandler`.", category: "error-handling", measuredBy: "errors" },
  { id: "FW-FASTAPI-DEPENDS", source: "framework", framework: "fastapi", title: "Depends()", statement: "FastAPI projects commonly provide sessions, services and the current user through `Depends()`.", category: "dependency-injection", measuredBy: "di" },
  { id: "FW-FASTAPI-ROUTERS", source: "framework", framework: "fastapi", title: "Routers delegate", statement: "FastAPI routers commonly delegate to service and repository modules.", category: "api", measuredBy: "dependency" },
  { id: "FW-FASTAPI-AUTH", source: "framework", framework: "fastapi", title: "Auth dependencies", statement: "FastAPI projects commonly enforce authentication through a shared dependency (e.g. `get_current_user`).", category: "security-boundary", measuredBy: "auth" },
  { id: "FW-SPRING-LAYERS", source: "framework", framework: "spring", title: "@Controller → @Service → @Repository", statement: "Spring projects commonly layer @Controller → @Service → @Repository.", category: "api", measuredBy: "dependency" },
  { id: "FW-SPRING-DI", source: "framework", framework: "spring", title: "Constructor injection", statement: "Spring projects commonly use constructor injection instead of instantiating beans.", category: "dependency-injection", measuredBy: "di" },
  { id: "FW-SPRING-ERRORS", source: "framework", framework: "spring", title: "@ControllerAdvice", statement: "Spring projects commonly centralise error responses in @ControllerAdvice.", category: "error-handling", measuredBy: "errors" },
  { id: "FW-RAILS-THIN", source: "framework", framework: "rails", title: "Thin controllers", statement: "Rails projects commonly keep controllers thin and persistence in models.", category: "api", measuredBy: "dependency" },
  { id: "FW-LARAVEL-THIN", source: "framework", framework: "laravel", title: "Controllers use models / services", statement: "Laravel projects commonly keep controllers thin, using Eloquent models or services.", category: "api", measuredBy: "dependency" },
  { id: "FW-DOTNET-DI", source: "framework", framework: "dotnet", title: "Built-in DI", statement: ".NET projects commonly register services in the DI container and inject them.", category: "dependency-injection", measuredBy: "di" },
  { id: "FW-GIN-DELEGATE", source: "framework", framework: "gin", title: "Handlers delegate", statement: "Gin projects commonly keep handlers thin and call services.", category: "api", measuredBy: "dependency" },
];

export function industryFor(type: ProjectType, types: ProjectType[]): Practice[] {
  const all = new Set([type, ...types]);
  return INDUSTRY.filter((p) => p.appliesTo.some((t) => all.has(t))).map(({ appliesTo: _a, ...p }) => (void _a, p));
}

export function frameworkFor(frameworks: string[]): Practice[] {
  const set = new Set(frameworks);
  return FRAMEWORK.filter((p) => p.framework && set.has(p.framework));
}
