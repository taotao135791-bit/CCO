import { createInterface } from 'readline';
import { configManager } from './manager.js';
import { authStore } from '../auth/auth-store.js';

let rl: ReturnType<typeof createInterface> | null = null;

function getReadline() {
  if (!rl) {
    rl = createInterface({ input: process.stdin, output: process.stdout });
  }
  return rl;
}

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    getReadline().question(question, (answer) => resolve(answer.trim()));
  });
}

function askPassword(question: string): Promise<string> {
  return new Promise((resolve) => {
    const iface = getReadline();
    // Hide input for password
    const stdout = process.stdout;
    const originalWrite = stdout.write.bind(stdout);
    let muted = false;

    stdout.write = (chunk: any, ...args: any[]) => {
      if (muted && typeof chunk === 'string') {
        // Don't echo typed characters
        return true as any;
      }
      return originalWrite(chunk, ...args);
    };

    muted = true;
    iface.question(question, (answer) => {
      muted = false;
      stdout.write = originalWrite;
      stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

interface ProviderPreset {
  name: string;
  label: string;
  group: string;
  formats: { format: 'anthropic' | 'openai'; baseURL: string; label: string }[];
  modelHint: string;
  /** Key prefix pattern for validation */
  keyPrefix?: string;
}

const PRESETS: ProviderPreset[] = [
  // ── 推荐 ─────────────────────────────────────
  {
    name: 'deepseek',
    label: 'DeepSeek',
    group: '推荐',
    formats: [
      { format: 'openai', baseURL: 'https://api.deepseek.com/v1', label: 'OpenAI 兼容格式（推荐，支持工具调用）' },
    ],
    modelHint: 'deepseek-chat, deepseek-reasoner',
  },
  {
    name: 'anthropic',
    label: 'Anthropic (Claude)',
    group: '推荐',
    formats: [
      { format: 'anthropic', baseURL: 'https://api.anthropic.com', label: 'Anthropic 原生格式' },
    ],
    modelHint: 'claude-sonnet-4-20250514, claude-opus-4-20250514',
    keyPrefix: 'sk-ant-',
  },
  {
    name: 'openai',
    label: 'OpenAI',
    group: '推荐',
    formats: [
      { format: 'openai', baseURL: 'https://api.openai.com/v1', label: 'OpenAI 兼容格式' },
    ],
    modelHint: 'gpt-4o, gpt-4o-mini, o3-mini, o4-mini',
    keyPrefix: 'sk-',
  },
  {
    name: 'openrouter',
    label: 'OpenRouter',
    group: '推荐',
    formats: [
      { format: 'openai', baseURL: 'https://openrouter.ai/api/v1', label: 'OpenAI 兼容格式' },
    ],
    modelHint: 'anthropic/claude-sonnet-4-20250514, openai/gpt-4o, google/gemini-2.5-pro',
    keyPrefix: 'sk-or-',
  },
  // ── 国内服务商 ─────────────────────────────────
  {
    name: 'kimi',
    label: 'Kimi (Moonshot)',
    group: '国内服务商',
    formats: [
      { format: 'openai', baseURL: 'https://api.kimi.com/coding/v1', label: 'OpenAI 兼容格式（Kimi For Coding）' },
      { format: 'openai', baseURL: 'https://api.moonshot.cn/v1', label: 'OpenAI 兼容格式（Moonshot 通用）' },
    ],
    modelHint: 'kimi-for-coding, kimi-k2-0711-preview',
  },
  {
    name: 'volcengine',
    label: '火山引擎（豆包）',
    group: '国内服务商',
    formats: [
      { format: 'openai', baseURL: 'https://ark.cn-beijing.volces.com/api/v3', label: 'OpenAI 兼容格式' },
    ],
    modelHint: 'doubao-pro-32k, doubao-pro-128k, doubao-1-5-pro-32k',
  },
  {
    name: 'zhipu',
    label: '智谱 AI (GLM)',
    group: '国内服务商',
    formats: [
      { format: 'openai', baseURL: 'https://open.bigmodel.cn/api/paas/v4', label: 'OpenAI 兼容格式' },
    ],
    modelHint: 'glm-4-plus, glm-4-air, glm-4-flash',
  },
  {
    name: 'dashscope',
    label: '阿里云百炼 (Qwen)',
    group: '国内服务商',
    formats: [
      { format: 'openai', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', label: 'OpenAI 兼容格式' },
    ],
    modelHint: 'qwen-max, qwen-plus, qwen3-coder-plus, qwq-plus',
  },
  {
    name: 'minimax',
    label: 'MiniMax',
    group: '国内服务商',
    formats: [
      { format: 'openai', baseURL: 'https://api.minimaxi.com/v1', label: 'OpenAI 兼容格式' },
    ],
    modelHint: 'MiniMax-M2.7, MiniMax-M2',
  },
  {
    name: 'xiaomi-mimo',
    label: '小米 MiMo',
    group: '国内服务商',
    formats: [
      { format: 'openai', baseURL: 'https://api.xiaomimimo.com/v1', label: 'OpenAI 兼容格式' },
    ],
    modelHint: 'MiMo-V2-Pro, MiMo-V2-Flash',
  },
  {
    name: 'siliconflow',
    label: 'SiliconFlow',
    group: '国内服务商',
    formats: [
      { format: 'openai', baseURL: 'https://api.siliconflow.cn/v1', label: 'OpenAI 兼容格式' },
    ],
    modelHint: 'deepseek-chat, Qwen/Qwen3-Coder',
  },
  // ── 国际服务商 ─────────────────────────────────
  {
    name: 'gemini',
    label: 'Gemini (Google)',
    group: '国际服务商',
    formats: [
      { format: 'openai', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', label: 'OpenAI 兼容格式' },
    ],
    modelHint: 'gemini-2.5-pro, gemini-2.5-flash',
  },
  // ── 自定义 ─────────────────────────────────────
  {
    name: 'custom',
    label: '自定义 / 其他',
    group: '自定义',
    formats: [],
    modelHint: '请咨询你的 API 提供商',
  },
];

/** Quick connection test using the provider's API format */
async function testConnection(
  format: 'anthropic' | 'openai',
  baseURL: string,
  apiKey: string,
  model: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (format === 'openai') {
      // Use a minimal chat completion request with max_tokens=1
      const url = `${baseURL.replace(/\/$/, '')}/chat/completions`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 1,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) return { ok: true };
      if (res.status === 401) return { ok: false, error: 'API Key 无效（401 Unauthorized）' };
      if (res.status === 404) return { ok: false, error: `模型不存在或 URL 错误（404）` };
      const text = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    } else {
      // Anthropic format
      const url = `${baseURL.replace(/\/$/, '')}/v1/messages`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 1,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) return { ok: true };
      if (res.status === 401) return { ok: false, error: 'API Key 无效（401 Unauthorized）' };
      if (res.status === 404) return { ok: false, error: `端点不存在或模型错误（404）` };
      const text = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
  } catch (err: any) {
    if (err.name === 'AbortError') return { ok: false, error: '连接超时（15秒）' };
    return { ok: false, error: err.message || String(err) };
  }
}

/** Validate API key format */
function validateApiKey(key: string, prefix?: string): string | undefined {
  if (!key || key.length < 8) return 'API Key 太短，请检查';
  if (prefix && !key.startsWith(prefix)) return `密钥通常以 "${prefix}" 开头，请确认`;
  return undefined;
}

export async function runSetup(): Promise<void> {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   🚀 Claude Code Open (CCO) 设置向导    ║');
  console.log('╚══════════════════════════════════════════╝\n');
  console.log('首次使用需要配置 API 连接信息。\n');

  // ── Step 1: Group display and provider selection ──
  const groups = new Map<string, ProviderPreset[]>();
  for (const p of PRESETS) {
    if (!groups.has(p.group)) groups.set(p.group, []);
    groups.get(p.group)!.push(p);
  }

  let idx = 1;
  const indexMap = new Map<number, ProviderPreset>();

  for (const [group, presets] of groups) {
    console.log(`  ── ${group} ──`);
    for (const p of presets) {
      const hasKey = authStore.hasKey(p.name) || configManager.hasApiKey(p.name);
      const marker = hasKey ? ' ✓' : '';
      console.log(`  [${String(idx).padStart(2)}] ${p.label}${marker}`);
      indexMap.set(idx, p);
      idx++;
    }
    console.log();
  }

  const presetChoice = await ask('请选择 API 提供商: ');
  const presetIndex = parseInt(presetChoice);
  const preset = indexMap.get(presetIndex) || PRESETS[PRESETS.length - 1];

  let format: 'anthropic' | 'openai';
  let baseURL: string;

  // ── Step 2: API format selection ──
  if (preset.formats.length === 1) {
    format = preset.formats[0].format;
    baseURL = preset.formats[0].baseURL;
    console.log(`\n📌 使用 ${preset.formats[0].label}`);
    console.log(`   baseURL: ${baseURL}`);
  } else if (preset.formats.length > 1) {
    console.log(`\n${preset.label} 支持多种 API 格式:\n`);
    preset.formats.forEach((f, i) => {
      console.log(`  [${i + 1}] ${f.label}`);
      console.log(`      baseURL: ${f.baseURL}`);
    });
    console.log();
    const formatChoice = await ask('请选择: ');
    const formatIndex = parseInt(formatChoice) - 1;
    const selected = preset.formats[formatIndex] || preset.formats[0];
    format = selected.format;
    baseURL = selected.baseURL;
  } else {
    // Custom provider
    console.log('\n你的 API 使用哪种协议格式？\n');
    console.log('  [1] OpenAI 兼容格式（端点 /v1/chat/completions）');
    console.log('  [2] Anthropic 原生格式（端点 /v1/messages）');
    console.log();
    const formatChoice = await ask('请选择 [1/2]: ');
    format = formatChoice === '2' ? 'anthropic' : 'openai';

    console.log('\n请输入 API 基础地址（baseURL）');
    console.log('  示例: https://api.openai.com/v1\n');
    baseURL = await ask('API 地址: ');
  }

  // ── Step 3: API Key input with validation ──
  let apiKey = '';
  let keyValid = false;
  while (!keyValid) {
    apiKey = await askPassword('\n🔑 请输入 API Key: ');

    const validationError = validateApiKey(apiKey, preset.keyPrefix);
    if (validationError) {
      console.log(`\n⚠️  ${validationError}`);
      const retry = await ask('是否重新输入？[Y/n]: ');
      if (retry.toLowerCase() === 'n') {
        // Allow user to proceed anyway
        keyValid = true;
      }
    } else {
      keyValid = true;
    }
  }

  // ── Step 4: Model selection ──
  console.log(`\n🧠 请输入模型名称`);
  console.log(`  推荐模型: ${preset.modelHint}`);
  console.log('  模型名需与 API 提供商一致\n');

  const modelInput = await ask('模型名称: ');
  const defaultModel = modelInput || (format === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o');

  // ── Step 5: Connection test ──
  console.log('\n⏳ 正在测试 API 连接...');
  const testResult = await testConnection(format, baseURL, apiKey, defaultModel);

  if (testResult.ok) {
    console.log('✅ 连接成功！\n');
  } else {
    console.log(`\n⚠️  连接测试失败: ${testResult.error}`);
    console.log('   你可以继续保存配置，稍后手动修复。\n');
    const proceed = await ask('是否仍然保存配置？[Y/n]: ');
    if (proceed.toLowerCase() === 'n') {
      console.log('配置已取消。\n');
      if (rl) { rl.close(); rl = null; }
      return;
    }
  }

  // ── Save configuration ──
  // Store API key in secure auth store
  authStore.setKey(preset.name, apiKey);

  // Parse model list from hint
  const models = preset.modelHint
    .split(', ')
    .map((m) => m.trim())
    .filter(Boolean);
  if (!models.includes(defaultModel)) {
    models.unshift(defaultModel);
  }

  configManager.updateProvider(preset.name, {
    format,
    baseURL,
    apiKey,
    defaultModel,
    models,
  });
  configManager.setActiveProvider(preset.name);

  console.log('╔══════════════════════════════════════════╗');
  console.log('║          ✅ 配置完成                     ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`  提供商:  ${preset.label}`);
  console.log(`  格式:    ${format === 'anthropic' ? 'Anthropic 原生' : 'OpenAI 兼容'}`);
  console.log(`  地址:    ${baseURL}`);
  console.log(`  模型:    ${defaultModel}`);
  console.log(`  API Key: ${authStore.getMaskedKey(preset.name) || '****'}`);
  console.log(`  存储:    ~/.cco/config.json + ~/.cco/auth.json\n`);

  if (rl) { rl.close(); rl = null; }
}

export function needsSetup(): boolean {
  const cfg = configManager.get();
  // Check both inline keys and auth store
  for (const p of cfg.providers) {
    if (p.apiKey || authStore.hasKey(p.name)) return false;
  }
  return true;
}
