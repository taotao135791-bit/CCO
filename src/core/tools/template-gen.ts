import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { cwd } from 'process';

interface Template {
  name: string;
  description: string;
  files: Array<{ path: string; content: string }>;
}

const TEMPLATES: Record<string, Template> = {
  gitignore: {
    name: '.gitignore',
    description: '通用 .gitignore 文件',
    files: [
      {
        path: '.gitignore',
        content: `# Dependencies
node_modules/
package-lock.json
yarn.lock
pnpm-lock.yaml

# Build output
dist/
build/
out/

# IDE
.vscode/
.idea/
*.swp
*.swo
*~

# OS
.DS_Store
Thumbs.db

# Environment
.env
.env.local
.env.*.local

# Logs
*.log
npm-debug.log*

# Testing
coverage/
.nyc_output/

# Temp
tmp/
temp/
`,
      },
    ],
  },
  ci: {
    name: 'GitHub Actions CI',
    description: 'GitHub Actions CI/CD 配置',
    files: [
      {
        path: '.github/workflows/ci.yml',
        content: `name: CI

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [18, 20]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: \${{ matrix.node-version }}
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - run: npm test
`,
      },
    ],
  },
  dockerfile: {
    name: 'Dockerfile',
    description: 'Node.js Docker 配置',
    files: [
      {
        path: 'Dockerfile',
        content: `FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
EXPOSE 3000
CMD ["node", "dist/index.js"]
`,
      },
      {
        path: '.dockerignore',
        content: `node_modules
dist
.git
.env
*.md
`,
      },
    ],
  },
  eslint: {
    name: 'ESLint',
    description: 'ESLint + Prettier 配置',
    files: [
      {
        path: 'eslint.config.mjs',
        content: `import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    ignores: ['dist/', 'node_modules/', 'coverage/'],
  },
);
`,
      },
      {
        path: '.prettierrc',
        content: `{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
`,
      },
    ],
  },
  readme: {
    name: 'README.md',
    description: '项目 README 模板',
    files: [
      {
        path: 'README.md',
        content: `# Project Name

> Brief description

## Features

- Feature 1
- Feature 2

## Getting Started

\`\`\`bash
npm install
npm run dev
\`\`\`

## Scripts

| Command | Description |
|---------|-------------|
| \`npm run dev\` | Start development server |
| \`npm run build\` | Build for production |
| \`npm test\` | Run tests |

## License

MIT
`,
      },
    ],
  },
};

/** List all available templates */
export function listTemplates(): Array<{ key: string; name: string; description: string }> {
  return Object.entries(TEMPLATES).map(([key, t]) => ({
    key,
    name: t.name,
    description: t.description,
  }));
}

/** Apply a template to the current project. Returns list of created files. */
export function applyTemplate(key: string, targetDir?: string): string[] {
  const template = TEMPLATES[key];
  if (!template) return [];

  const base = targetDir || cwd();
  const created: string[] = [];

  for (const file of template.files) {
    const fullPath = join(base, file.path);
    if (existsSync(fullPath)) continue; // don't overwrite
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, file.content, 'utf-8');
    created.push(file.path);
  }

  return created;
}
