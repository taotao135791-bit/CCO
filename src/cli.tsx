#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { program } from 'commander';
import { App } from './app.js';
import { configManager } from './core/config/manager.js';
import { authStore } from './core/auth/auth-store.js';
import { needsSetup, runSetup } from './core/config/setup.js';
import { installTerminalMouseInput } from './core/terminal/mouse.js';

program
  .name('cco')
  .description('Claude Code Open - Multi-agent AI coding assistant')
  .version('1.6.0')
  .option('-p, --provider <name>', 'Set active provider')
  .option('-m, --model <name>', 'Set model')
  .option('-k, --api-key <key>', 'Set API key')
  .option('--base-url <url>', 'Set base URL')
  .option('-d, --debug', 'Enable debug mode')
  .parse();

const options = program.opts();

// Apply CLI overrides
if (options.provider) {
  configManager.setActiveProvider(options.provider);
}
if (options.model || options.apiKey || options.baseUrl) {
  const provider = configManager.getActiveProvider();
  configManager.updateProvider(provider.name, {
    ...(options.model && { defaultModel: options.model }),
    ...(options.apiKey && { apiKey: options.apiKey }),
    ...(options.baseUrl && { baseURL: options.baseUrl }),
  });
  // Store API key in auth store when provided via CLI
  if (options.apiKey) {
    authStore.setKey(provider.name, options.apiKey);
  }
}
if (options.debug) {
  const cfg = configManager.get();
  cfg.debug = true;
  configManager.save(cfg);
}

async function main() {
  // Make sure a previous crashed session did not leave terminal mouse reporting enabled.
  process.stdout.write('\x1b[?1006l\x1b[?1002l\x1b[?1000l');
  installTerminalMouseInput();

  // Check if setup is needed
  if (needsSetup() && !options.apiKey) {
    await runSetup();
  }

  // Check if API key is set (check both inline and auth store)
  const provider = configManager.getActiveProvider();
  if (!provider.apiKey && !authStore.hasKey(provider.name)) {
    console.error(`\n❌ 提供商 "${provider.name}" 未配置 API Key`);
    console.error(`\n设置方式：`);
    console.error(`  cco --api-key <your-key>          命令行设置`);
    console.error(`  cco --provider <名称>               切换提供商`);
    console.error(`  编辑: ${configManager.getConfigDir()}/config.json`);
    console.error(`  或:   ${configManager.getConfigDir()}/auth.json\n`);
    process.exit(1);
  }

  render(<App />, { patchConsole: false });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
