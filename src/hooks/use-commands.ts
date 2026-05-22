import { useCallback } from 'react';
import { agentManager } from '../core/agent/manager.js';
import { configManager } from '../core/config/manager.js';
import { skillRegistry } from '../core/skills/registry.js';
import { mcpManager } from '../core/mcp/client.js';
import { sessionPersistence } from '../core/agent/persistence.js';
import { listRoles, getRole } from '../core/agent/roles.js';
import { workflowEngine } from '../core/agent/workflows.js';
import { codeIndexer } from '../core/tools/indexer.js';
import { buildCostReport } from '../core/llm/cost-estimate.js';
import { detectProject, projectDescription } from '../core/agent/project-detect.js';
import type { DisplayMessage } from './use-agent-manager.js';

type SetMessages = React.Dispatch<React.SetStateAction<DisplayMessage[]>>;

export interface CommandDeps {
  setMessages: SetMessages;
  setShowHelp: (v: boolean) => void;
  setShowAgents: React.Dispatch<React.SetStateAction<boolean>>;
  setShowTaskPanel: React.Dispatch<React.SetStateAction<boolean>>;
  setIsProcessing: (v: boolean) => void;
  setActiveAgentId: (id: string) => void;
  activeAgentId: string;
  addSystemMessage: (content: string) => void;
  nextId: (prefix?: string) => string;
  exit: () => void;
}

/**
 * Hook returning the command handler for slash-commands.
 */
export function useCommands(deps: CommandDeps) {
  const {
    setShowHelp, setShowAgents, setShowTaskPanel,
    setIsProcessing, setActiveAgentId, activeAgentId,
    addSystemMessage, exit,
  } = deps;

  const handleCommand = useCallback(
    async (cmd: string, args: string[]) => {
      switch (cmd.toLowerCase()) {
        case 'help':
        case 'h':
          setShowHelp(true);
          setTimeout(() => setShowHelp(false), 15000);
          break;

        case 'quit':
        case 'q':
        case 'exit':
          exit();
          break;

        case 'clear':
          deps.setMessages([]);
          addSystemMessage('聊天记录已清空');
          break;

        case 'agents':
        case 'a':
          setShowAgents((v) => !v);
          break;

        case 'agent': {
          const agentId = args[0];
          if (agentId && agentManager.getAgent(agentId)) {
            agentManager.setActiveAgent(agentId);
            setActiveAgentId(agentId);
            addSystemMessage(`已切换到 Agent: ${agentId}`);
          } else {
            addSystemMessage(`未找到 Agent: ${agentId}`);
          }
          break;
        }

        case 'new': {
          const name = args[0] || `Agent ${agentManager.agents.size + 1}`;
          const agent = agentManager.createAgent({ name });
          agentManager.setActiveAgent(agent.id);
          setActiveAgentId(agent.id);
          addSystemMessage(`已创建新 Agent: ${agent.name} (${agent.id})`);
          break;
        }

        case 'role': {
          const roleKey = args[0];
          if (!roleKey) {
            const roles = listRoles();
            const text = roles.map((r) => `  • ${r.key}: ${r.name} - ${r.description}`).join('\n');
            addSystemMessage(`可用角色:\n${text}`);
            break;
          }
          const role = getRole(roleKey);
          if (role) {
            const name = args[1] || `${role.name} ${agentManager.agents.size + 1}`;
            const agent = agentManager.createAgent({ name, systemPrompt: role.systemPrompt });
            agentManager.setActiveAgent(agent.id);
            setActiveAgentId(agent.id);
            addSystemMessage(`已创建 ${role.name}: ${agent.name} (${agent.id})`);
          } else {
            addSystemMessage(`未找到角色: ${roleKey}，输入 /role 查看列表`);
          }
          break;
        }

        case 'kill': {
          const killId = args[0];
          if (killId && killId !== 'main') {
            agentManager.removeAgent(killId);
            addSystemMessage(`已移除 Agent: ${killId}`);
          } else {
            addSystemMessage('无法移除 main Agent 或无效的 ID');
          }
          break;
        }

        case 'msg': {
          const [toId, ...contentParts] = args;
          const content = contentParts.join(' ');
          if (toId && content) {
            agentManager.sendAgentMessage(activeAgentId, toId, content);
            addSystemMessage(`已发送给 ${toId}: ${content}`);
          } else {
            addSystemMessage('用法: /msg <agent-id> <消息内容>');
          }
          break;
        }

        case 'broadcast': {
          const bcontent = args.join(' ');
          agentManager.broadcast(activeAgentId, bcontent);
          addSystemMessage(`已广播: ${bcontent}`);
          break;
        }

        case 'delegate': {
          const task = args.join(' ');
          if (task) {
            addSystemMessage(`正在委派任务: ${task}`);
            setIsProcessing(true);
            try {
              await agentManager.delegateTask(task);
              addSystemMessage('任务委派完成');
            } catch (err: any) {
              addSystemMessage(`委派失败: ${err.message || String(err)}`);
            }
            setIsProcessing(false);
          } else {
            addSystemMessage('用法: /delegate <任务描述>');
          }
          break;
        }

        case 'model': {
          const model = args[0];
          if (model) {
            const provider = configManager.getActiveProvider();
            configManager.updateProvider(provider.name, { defaultModel: model });
            addSystemMessage(`模型已切换为: ${model}`);
          }
          break;
        }

        case 'provider': {
          const providerName = args[0];
          if (providerName) {
            configManager.setActiveProvider(providerName);
            addSystemMessage(`提供商已切换为: ${providerName}`);
          }
          break;
        }

        case 'skill': {
          skillRegistry.init();
          const skillName = args[0];
          if (!skillName) {
            const skills = skillRegistry.list();
            const text = skills.map((s) => `  • ${s.name}: ${s.description}`).join('\n');
            addSystemMessage(`可用技能:\n${text}`);
            break;
          }
          const skill = skillRegistry.get(skillName);
          if (skill) {
            const agent = agentManager.getActiveAgent();
            agent.messages[0] = { role: 'system', content: skill.prompt, agent: agent.name };
            addSystemMessage(`技能已激活: ${skill.name}\n${skill.description}`);
          } else {
            addSystemMessage(`未找到技能: ${skillName}`);
          }
          break;
        }

        case 'review': {
          setIsProcessing(true);
          const target = args[0];
          workflowEngine.reviewCode(target).then((result) => {
            setIsProcessing(false);
            if (result.success) {
              addSystemMessage(`代码审查完成。${result.summary}`);
            } else {
              addSystemMessage(`审查失败: ${result.error}`);
            }
          });
          break;
        }

        case 'pair': {
          const task = args.join(' ');
          if (task) {
            setIsProcessing(true);
            workflowEngine.pairProgramming(task).then((result) => {
              setIsProcessing(false);
              addSystemMessage(`结对编程已启动。${result.summary}`);
            });
          } else {
            addSystemMessage('用法: /pair <编码任务>');
          }
          break;
        }

        case 'swarm': {
          const [pattern, ...instrParts] = args;
          const instruction = instrParts.join(' ');
          if (pattern && instruction) {
            setIsProcessing(true);
            workflowEngine.swarm(pattern, instruction).then((result) => {
              setIsProcessing(false);
              if (result.success) {
                addSystemMessage(`批量处理完成。${result.summary}`);
              } else {
                addSystemMessage(`批量处理失败: ${result.error}`);
              }
            });
          } else {
            addSystemMessage('用法: /swarm <glob模式> <指令>');
          }
          break;
        }

        case 'index': {
          setIsProcessing(true);
          codeIndexer.buildIndex().then((count) => {
            setIsProcessing(false);
            const stats = codeIndexer.getStats();
            addSystemMessage(`已索引 ${count} 个文件。总计: ${stats.totalFiles} 个文件，${(stats.totalSize / 1024).toFixed(1)} KB`);
          });
          break;
        }

        case 'search': {
          const query = args.join(' ');
          if (query) {
            const results = codeIndexer.search(query);
            const text = results.map((r) => `  • ${r.path} (${(r.size / 1024).toFixed(1)} KB)`).join('\n');
            addSystemMessage(`搜索 "${query}" 的结果:\n${text || '无匹配结果'}`);
          } else {
            addSystemMessage('用法: /search <查询关键词>');
          }
          break;
        }

        case 'mcp': {
          const mcpCmd = args[0];
          if (mcpCmd === 'list') {
            const servers = mcpManager.getServerNames();
            const text = servers.length ? servers.join('\n') : '无 MCP 服务器连接';
            addSystemMessage(`MCP 服务器:\n${text}`);
          } else if (mcpCmd === 'connect' && args[1]) {
            const serverName = args[1];
            const cfg = configManager.get().mcpServers[serverName];
            if (cfg) {
              mcpManager.connectServer(serverName, cfg)
                .then(() => addSystemMessage(`MCP 服务器已连接: ${serverName}`))
                .catch((err: any) => addSystemMessage(`连接失败: ${err.message || String(err)}`));
            } else {
              addSystemMessage(`未找到 MCP 配置: ${serverName}`);
            }
          } else {
            addSystemMessage('用法: /mcp list | /mcp connect <名称>');
          }
          break;
        }

        case 'tasks':
          setShowTaskPanel((v) => !v);
          break;

        case 'save': {
          const agent = agentManager.getActiveAgent();
          sessionPersistence.autoSave(agent.id, agent.name, agent.messages, agent.parentAgent);
          addSystemMessage(`会话已保存: ${agent.name}`);
          break;
        }

        case 'load': {
          const loadId = args[0];
          if (loadId) {
            const session = sessionPersistence.loadSession(loadId);
            if (session) {
              const agent = agentManager.createAgent({
                id: session.agentId, name: session.name, parentAgent: session.parentAgent,
              });
              agent.messages = session.messages;
              agentManager.setActiveAgent(agent.id);
              setActiveAgentId(agent.id);
              addSystemMessage(`已加载会话: ${session.name} (${session.messages.length} 条消息)`);
            } else {
              addSystemMessage(`未找到会话: ${loadId}`);
            }
          } else {
            addSystemMessage('用法: /load <agent-id>');
          }
          break;
        }

        case 'sessions': {
          const sessions = sessionPersistence.listSessions();
          const text = sessions
            .map((s) => `  • ${s.name} (${s.agentId}) - ${s.messages.length} 条消息 - ${new Date(s.updatedAt).toLocaleString()}`)
            .join('\n');
          addSystemMessage(text || '无已保存的会话');
          break;
        }

        case 'branch': {
          const branchName = args[0] || `分支_${Date.now()}`;
          const agent = agentManager.getActiveAgent();
          const msgIndex = args[1] ? parseInt(args[1]) : agent.messages.length - 1;
          const branched = sessionPersistence.createBranch(branchName, agent.messages, msgIndex);
          if (branched) {
            const newAgent = agentManager.createAgent({ name: branchName });
            newAgent.messages = branched;
            agentManager.setActiveAgent(newAgent.id);
            setActiveAgentId(newAgent.id);
            addSystemMessage(`已创建会话分支: ${branchName} (${branched.length} 条消息)`);
          } else {
            addSystemMessage('创建分支失败');
          }
          break;
        }

        case 'cost': {
          const agent = agentManager.getActiveAgent();
          const provider = configManager.getActiveProvider();
          const text = buildCostReport(agent.totalInputTokens, agent.totalOutputTokens, provider.defaultModel);
          addSystemMessage(text);
          break;
        }

        case 'rules': {
          const rules = configManager.getProjectRules();
          if (rules) {
            const rulesPath = configManager.getProjectRulesPath() || '.cco/rules.md';
            addSystemMessage(`项目规则 (${rulesPath}):\n${rules}`);
          } else {
            addSystemMessage('未找到项目规则。在项目根目录创建 .cco/rules.md 来设置。');
          }
          break;
        }

        case 'project': {
          const info = detectProject(process.cwd());
          addSystemMessage(projectDescription(info));
          break;
        }

        case 'config': {
          const cfg = configManager.get();
          const provider = configManager.getActiveProvider();
          const text = `
活跃提供商: ${cfg.activeProvider}
Base URL: ${provider.baseURL}
模型: ${provider.defaultModel}
最大 Token: ${cfg.defaultMaxTokens}
Agent 数量: ${agentManager.agents.size}
调试模式: ${cfg.debug}
Computer Use: ${cfg.computerUse.enabled}
MCP 服务器: ${Object.keys(cfg.mcpServers).join(', ') || '无'}
          `.trim();
          addSystemMessage(text);
          break;
        }

        default:
          addSystemMessage(`未知命令: /${cmd}，输入 /help 查看可用命令。`);
      }
    },
    [activeAgentId, exit, setShowHelp, setShowAgents, setShowTaskPanel, setIsProcessing, setActiveAgentId, addSystemMessage, deps],
  );

  return { handleCommand };
}
