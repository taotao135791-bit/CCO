# Claude Code Open (CCO)

**开源版 Claude Code。多 Agent、任意 API Key、零学习成本。**

> 专为中文开发者打造。支持 Anthropic / OpenRouter / OpenAI / Gemini / 自定义中转。

---

## 特性

| 特性 | 状态 |
|------|------|
| 💬 多轮对话 + 流式输出 | ✅ |
| 🔧 内置工具（Read/Write/Edit/Bash/Glob/WebSearch/WebFetch） | ✅ |
| 🤖 **多 Agent 架构**（并行/协作/通信） | ✅ |
| 🔌 MCP 客户端（多服务器管理） | ✅ |
| 🎯 Skills 技能系统 | ✅ |
| 🖥️ Computer Use（截图/点击/输入） | ✅ |
| 📓 Jupyter Notebook 支持 | ✅ |
| 🔐 权限系统（allow/deny/ask） | ✅ |
| ⚡ 任意 API Key / Base URL | ✅ |
| 🧠 **自适应并行**（自动检测并行机会） | ✅ |
| 🏗️ **工作流引擎**（Review / Pair / Swarm） | ✅ |
| 📦 **工作目录隔离**（临时目录 + 合并） | ✅ |
| ⚡ **Prompt Cache + 代码索引** | ✅ |
| 💾 会话持久化 | ✅ |
| 🎭 Agent 角色模板（9种） | ✅ |

---

## 安装

```bash
git clone <repo>
cd claude-code-open
npm install
npm run build
npm link  # 或 npm install -g .
```

---

## 快速开始

### 1. 配置 API Key

```bash
# 首次运行会自动引导配置
co

# 或命令行直接指定
co --api-key sk-xxx --provider openrouter
```

### 2. 启动

```bash
co
```

---

## 完整命令手册

### 基础命令

| 命令 | 说明 |
|------|------|
| `/help`, `/h` | 显示帮助 |
| `/quit`, `/q` | 退出 |
| `/clear` | 清空对话 |
| `/config` | 显示当前配置 |

### Agent 管理

| 命令 | 说明 |
|------|------|
| `/new [name]` | 创建新 Agent |
| `/kill <id>` | 移除 Agent |
| `/agent <id>` | 切换到指定 Agent |
| `/agents`, `/a`, `Tab` | 显示/隐藏 Agent 面板 |
| `/role [key] [name]` | 按角色创建 Agent |
| `/msg <id> <text>` | 给指定 Agent 发消息 |
| `/broadcast <text>` | 广播给所有 Agent |
| `Alt+1~9` | 快速切换 Agent |

### 并行与协作

| 命令 | 说明 |
|------|------|
| `/delegate <task>` | **智能并行委派** — Coordinator 自动拆分任务，多 Worker 并行执行 |
| `/review [path]` | **自动代码审查** — 创建 Reviewer Agent 审查代码库 |
| `/pair <task>` | **结对编程** — Pair Agent 写初稿，主 Agent 改进 |
| `/swarm <pattern> <instruction>` | **蜂群处理** — 多个 Worker 同时处理匹配的文件 |
| `/tasks` | 显示/隐藏并行任务进度面板 |

### 代码索引

| 命令 | 说明 |
|------|------|
| `/index` | 构建代码索引 |
| `/search <query>` | 搜索索引中的代码 |

### 配置与持久化

| 命令 | 说明 |
|------|------|
| `/model <name>` | 切换模型 |
| `/provider <name>` | 切换 Provider |
| `/skill [name]` | 列出或激活 Skill |
| `/mcp list` | 列出 MCP 服务器 |
| `/mcp connect <name>` | 连接 MCP 服务器 |
| `/save` | 保存当前会话 |
| `/load <id>` | 加载会话 |
| `/sessions` | 列出所有保存的会话 |

---

## 多 Agent 协作工作流

### 场景 1：并行任务（/delegate）

```
> 帮我重构错误处理，同时写测试覆盖所有边界情况

💡 检测到并行信号: 多动作描述. 建议: 输入 /delegate 来并行执行

> /delegate 重构错误处理并写测试覆盖

[Coordinator 自动规划]
TASKS:
1. 重构 src/core 下的错误处理逻辑
2. 为 utils 模块写边界测试
3. 为 agent 引擎写异常测试

[3个 Worker 并行执行...]
Worker-abc: ● 重构中...
Worker-def: ● 写测试中...
Worker-ghi: ● 写测试中...

[Lead Agent 合成最终结果]
✅ 重构完成，测试覆盖 15 个边界...
```

### 场景 2：代码审查（/review）

```
> /review src/core

[Reviewer Agent 自动读取所有文件]
[审查报告生成中...]

Code Review Report:
- agent/engine.ts: 缺少错误处理边界...
- tools/executor.ts: Bash 命令未做输入校验...

[报告自动反馈给主 Agent]
> 请修复上述问题
```

### 场景 3：结对编程（/pair）

```
> /pair 实现一个 LRU Cache

[Pair Agent 写初稿]
[主 Agent 审查并改进]

✅ 结对完成，代码已写入 src/cache.ts
```

### 场景 4：蜂群处理（/swarm）

```
> /swarm "src/**/*.ts" "给每个文件添加 JSDoc 注释"

[8个 Worker 同时处理不同文件...]
✅ 已处理 8/8 文件
```

---

## Agent 角色系统

| 角色 | 用途 | 创建方式 |
|------|------|---------|
| `default` | 通用助手 | `/new` |
| `reviewer` | 代码审查 | `/role reviewer` |
| `tester` | 生成测试 | `/role tester` |
| `refactor` | 重构专家 | `/role refactor` |
| `debugger` | 调试排错 | `/role debugger` |
| `architect` | 架构设计 | `/role architect` |
| `security` | 安全审计 | `/role security` |
| `performance` | 性能优化 | `/role performance` |
| `worker` | 专注执行 | `/role worker` |

---

## 配置

配置文件位于 `~/.cco/config.json`：

```json
{
  "activeProvider": "openrouter",
  "providers": [
    {
      "name": "openrouter",
      "baseURL": "https://openrouter.ai/api/v1",
      "apiKey": "sk-or-v1-xxx",
      "defaultModel": "anthropic/claude-sonnet-4-20250514",
      "models": ["anthropic/claude-opus-4-20250514"]
    }
  ],
  "permissions": {
    "allow": ["Read(*)", "Bash(npm *)"],
    "deny": ["Bash(rm -rf *)", "Bash(sudo *)"],
    "ask": ["Write(*.env)"]
  },
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
    }
  },
  "computerUse": {
    "enabled": false,
    "displayWidth": 1280,
    "displayHeight": 800
  },
  "multiAgent": {
    "enabled": true,
    "maxAgents": 4
  }
}
```

---

## 开发

```bash
npm run dev       # 监听编译
npm run build     # 编译
npm start         # 运行
npm test          # 运行测试
npm run test:watch # 监听测试
npm run lint      # 类型检查
```

---

## License

MIT
