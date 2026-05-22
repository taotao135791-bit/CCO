#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { program } from 'commander';
import { App } from './app.js';
import { configManager } from './core/config/manager.js';
import { needsSetup, runSetup } from './core/config/setup.js';
import { installTerminalMouseInput } from './core/terminal/mouse.js';

program
  .name('cco')
  .description('Claude Code Open - Multi-agent AI coding assistant')
  .version('1.0.0')
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

  // Check if API key is set
  const provider = configManager.getActiveProvider();
  if (!provider.apiKey) {
    console.error(`\n❌ No API key configured for provider: ${provider.name}`);
    console.error(`\nSet it with:`);
    console.error(`  cco --api-key <your-key>`);
    console.error(`\nOr edit: ${configManager.getConfigDir()}/config.json\n`);
    process.exit(1);
  }

  render(<App />, { patchConsole: false });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
