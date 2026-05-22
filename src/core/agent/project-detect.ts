import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export interface ProjectInfo {
  type: string;
  language: string;
  framework?: string;
  buildTool?: string;
  testRunner?: string;
  packageManager?: string;
  entryPoint?: string;
}

/**
 * Detect project type from config files in the given root directory.
 */
export function detectProject(root: string): ProjectInfo {
  const info: ProjectInfo = { type: 'unknown', language: 'unknown' };

  // Node.js / TypeScript
  if (existsSync(join(root, 'package.json'))) {
    info.type = 'node';
    info.language = 'typescript'; // assume ts if tsconfig exists
    info.packageManager = existsSync(join(root, 'pnpm-lock.yaml')) ? 'pnpm'
      : existsSync(join(root, 'yarn.lock')) ? 'yarn' : 'npm';

    if (!existsSync(join(root, 'tsconfig.json'))) {
      info.language = 'javascript';
    }

    // Detect framework
    try {
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps['next']) info.framework = 'Next.js';
      else if (deps['nuxt'] || deps['nuxt3']) info.framework = 'Nuxt';
      else if (deps['@remix-run/node']) info.framework = 'Remix';
      else if (deps['react']) info.framework = 'React';
      else if (deps['vue']) info.framework = 'Vue';
      else if (deps['svelte']) info.framework = 'Svelte';
      else if (deps['express']) info.framework = 'Express';
      else if (deps['fastify']) info.framework = 'Fastify';
      else if (deps['nest']) info.framework = 'NestJS';

      // Build tool
      if (deps['vite']) info.buildTool = 'Vite';
      else if (deps['webpack']) info.buildTool = 'Webpack';
      else if (deps['esbuild']) info.buildTool = 'esbuild';
      else if (deps['turbo']) info.buildTool = 'Turborepo';

      // Test runner
      if (deps['vitest']) info.testRunner = 'Vitest';
      else if (deps['jest']) info.testRunner = 'Jest';
      else if (deps['mocha']) info.testRunner = 'Mocha';
    } catch { /* ignore parse errors */ }
  }

  // Python
  if (existsSync(join(root, 'pyproject.toml')) || existsSync(join(root, 'setup.py')) || existsSync(join(root, 'requirements.txt'))) {
    info.type = 'python';
    info.language = 'python';
    if (existsSync(join(root, 'pyproject.toml'))) {
      info.buildTool = 'pyproject';
      try {
        const content = readFileSync(join(root, 'pyproject.toml'), 'utf-8');
        if (content.includes('pytest')) info.testRunner = 'pytest';
        if (content.includes('django')) info.framework = 'Django';
        if (content.includes('fastapi')) info.framework = 'FastAPI';
        if (content.includes('flask')) info.framework = 'Flask';
      } catch { /* ignore */ }
    }
    info.packageManager = existsSync(join(root, 'poetry.lock')) ? 'poetry'
      : existsSync(join(root, 'Pipfile.lock')) ? 'pipenv' : 'pip';
  }

  // Go
  if (existsSync(join(root, 'go.mod'))) {
    info.type = 'go';
    info.language = 'go';
    info.buildTool = 'go build';
    info.testRunner = 'go test';
  }

  // Rust
  if (existsSync(join(root, 'Cargo.toml'))) {
    info.type = 'rust';
    info.language = 'rust';
    info.buildTool = 'cargo';
    info.testRunner = 'cargo test';
  }

  // Java / Kotlin
  if (existsSync(join(root, 'pom.xml'))) {
    info.type = 'java';
    info.language = 'java';
    info.buildTool = 'Maven';
    info.testRunner = 'JUnit';
  }
  if (existsSync(join(root, 'build.gradle')) || existsSync(join(root, 'build.gradle.kts'))) {
    info.type = 'java';
    info.language = existsSync(join(root, 'build.gradle.kts')) ? 'kotlin' : 'java';
    info.buildTool = 'Gradle';
  }

  return info;
}

/**
 * Generate a project description string for system prompt injection.
 */
export function projectDescription(info: ProjectInfo): string {
  const parts: string[] = [];
  parts.push(`项目类型: ${info.type} (${info.language})`);
  if (info.framework) parts.push(`框架: ${info.framework}`);
  if (info.buildTool) parts.push(`构建工具: ${info.buildTool}`);
  if (info.testRunner) parts.push(`测试: ${info.testRunner}`);
  if (info.packageManager) parts.push(`包管理: ${info.packageManager}`);
  return parts.join(' | ');
}

/**
 * Get recommended Grep include patterns based on project type.
 */
export function recommendedGrepPatterns(info: ProjectInfo): string[] {
  switch (info.language) {
    case 'typescript': return ['*.ts', '*.tsx'];
    case 'javascript': return ['*.js', '*.jsx', '*.mjs'];
    case 'python': return ['*.py'];
    case 'go': return ['*.go'];
    case 'rust': return ['*.rs'];
    case 'java': return ['*.java'];
    case 'kotlin': return ['*.kt'];
    default: return ['*'];
  }
}
