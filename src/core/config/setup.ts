import { createInterface } from 'readline';
import { configManager } from './manager.js';

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

interface ProviderPreset {
  name: string;
  label: string;
  formats: { format: 'anthropic' | 'openai'; baseURL: string; label: string }[];
  modelHint: string;
}

const PRESETS: ProviderPreset[] = [
  {
    name: 'deepseek',
    label: 'DeepSeek',
    formats: [
      { format: 'openai', baseURL: 'https://api.deepseek.com/v1', label: 'OpenAI 兼容格式（推荐，支持工具调用）' },
      { format: 'anthropic', baseURL: 'https://api.deepseek.com/anthropic', label: 'Anthropic 原生格式（⚠️ 不支持工具调用，仅基础对话）' },
    ],
    modelHint: 'deepseek-chat, deepseek-reasoner',
  },
  {
    name: 'anthropic',
    label: 'Anthropic (Claude 官方)',
    formats: [
      { format: 'anthropic', baseURL: 'https://api.anthropic.com', label: 'Anthropic 原生格式' },
    ],
    modelHint: 'claude-sonnet-4-20250514, claude-opus-4-20250514',
  },
  {
    name: 'openai',
    label: 'OpenAI',
    formats: [
      { format: 'openai', baseURL: 'https://api.openai.com/v1', label: 'OpenAI 兼容格式' },
    ],
    modelHint: 'gpt-4o, gpt-4o-mini, o3-mini',
  },
  {
    name: 'openrouter',
    label: 'OpenRouter',
    formats: [
      { format: 'openai', baseURL: 'https://openrouter.ai/api/v1', label: 'OpenAI 兼容格式' },
    ],
    modelHint: 'anthropic/claude-sonnet-4-20250514, openai/gpt-4o',
  },
  {
    name: 'kimi',
    label: 'Kimi (Moonshot)',
    formats: [
      { format: 'openai', baseURL: 'https://api.kimi.com/coding/v1', label: 'OpenAI 兼容格式（Kimi For Coding）' },
      { format: 'openai', baseURL: 'https://api.moonshot.cn/v1', label: 'OpenAI 兼容格式（Moonshot 通用）' },
    ],
    modelHint: 'kimi-for-coding, kimi-k2-0711-preview',
  },
  {
    name: 'gemini',
    label: 'Gemini (Google)',
    formats: [
      { format: 'openai', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', label: 'OpenAI 兼容格式' },
    ],
    modelHint: 'gemini-2.5-pro, gemini-2.5-flash',
  },
  {
    name: 'volcengine',
    label: '火山引擎（豆包）',
    formats: [
      { format: 'openai', baseURL: 'https://ark.cn-beijing.volces.com/api/v3', label: 'OpenAI 兼容格式' },
    ],
    modelHint: 'doubao-pro-32k, doubao-pro-128k, doubao-1-5-pro-32k',
  },
  {
    name: 'zhipu',
    label: '智谱 AI (GLM)',
    formats: [
      { format: 'openai', baseURL: 'https://open.bigmodel.cn/api/paas/v4', label: 'OpenAI 兼容格式' },
    ],
    modelHint: 'glm-4-plus, glm-4-air, glm-4-flash',
  },
  {
    name: 'dashscope',
    label: '阿里云百炼 (Qwen)',
    formats: [
      { format: 'openai', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', label: 'OpenAI 兼容格式' },
    ],
    modelHint: 'qwen-max, qwen-plus, qwen3-coder-plus, qwq-plus',
  },
  {
    name: 'minimax',
    label: 'MiniMax',
    formats: [
      { format: 'openai', baseURL: 'https://api.minimaxi.com/v1', label: 'OpenAI 兼容格式' },
    ],
    modelHint: 'MiniMax-M2.7, MiniMax-M2',
  },
  {
    name: 'xiaomi-mimo',
    label: '小米 MiMo',
    formats: [
      { format: 'openai', baseURL: 'https://api.xiaomimimo.com/v1', label: 'OpenAI 兼容格式' },
    ],
    modelHint: 'MiMo-V2-Pro, MiMo-V2-Flash',
  },
  {
    name: 'siliconflow',
    label: 'SiliconFlow',
    formats: [
      { format: 'openai', baseURL: 'https://api.siliconflow.cn/v1', label: 'OpenAI 兼容格式' },
    ],
    modelHint: 'deepseek-chat, Qwen/Qwen3-Coder',
  },
  {
    name: 'custom',
    label: '自定义 / 其他',
    formats: [],
    modelHint: '请咨询你的 API 提供商',
  },
];

export async function runSetup(): Promise<void> {
  console.log('\n🚀 欢迎使用 Claude Code Open (CCO)!\n');
  console.log('首次使用需要配置 API 连接信息。\n');

  // Step 1: 选择 Provider 预设
  console.log('请选择你的 API 提供商:\n');
  PRESETS.forEach((p, i) => {
    console.log(`  [${i + 1}] ${p.label}`);
  });
  console.log();

  const presetChoice = await ask('请选择: ');
  const presetIndex = parseInt(presetChoice) - 1;
  const preset = PRESETS[presetIndex] || PRESETS[PRESETS.length - 1];

  let format: 'anthropic' | 'openai';
  let baseURL: string;

  // Step 2: 选择格式（如果该 provider 支持多种格式）
  if (preset.formats.length === 1) {
    format = preset.formats[0].format;
    baseURL = preset.formats[0].baseURL;
    console.log(`\n📌 使用 ${preset.formats[0].label}`);
    console.log(`   baseURL: ${baseURL}`);
  } else if (preset.formats.length > 1) {
    console.log(`\n${preset.label} 支持多种 API 格式，请选择:\n`);
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
    // 自定义：手动选择格式和输入 baseURL
    console.log('\n你的 API 使用哪种协议格式？\n');
    console.log('  [1] Anthropic 原生格式（端点 /v1/messages）');
    console.log('  [2] OpenAI 兼容格式（端点 /v1/chat/completions）');
    console.log();
    const formatChoice = await ask('请选择 [1/2]: ');
    format = formatChoice === '1' ? 'anthropic' : 'openai';

    console.log('\n请输入 API 基础地址（baseURL）');
    console.log('  示例: https://api.openai.com/v1');
    console.log('  示例: https://api.moonshot.cn\n');
    baseURL = await ask('API 地址: ');
  }

  // Step 3: 输入 API Key
  const apiKey = await ask('\n请输入 API Key: ');

  // Step 4: 输入模型名称
  console.log('\n请输入模型名称');
  console.log(`  支持模型: ${preset.modelHint}`);
  console.log('  模型名需与 API 提供商一致\n');

  const modelInput = await ask('模型名称: ');
  const defaultModel = modelInput || (format === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o');

  // 保存配置
  configManager.updateProvider(preset.name, {
    format,
    baseURL,
    apiKey,
    defaultModel,
    models: [defaultModel],
  });
  configManager.setActiveProvider(preset.name);

  console.log('\n✅ 配置已保存到 ~/.cco/config.json');
  console.log(`   提供商: ${preset.label}`);
  console.log(`   格式: ${format === 'anthropic' ? 'Anthropic 原生' : 'OpenAI 兼容'}`);
  console.log(`   地址: ${baseURL}`);
  console.log(`   模型: ${defaultModel}\n`);
  rl.close();
}

export function needsSetup(): boolean {
  const cfg = configManager.get();
  return cfg.providers.every((p) => !p.apiKey);
}
