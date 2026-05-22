import { useCallback } from 'react';
import { agentManager } from '../core/agent/manager.js';
import { configManager } from '../core/config/manager.js';
import { skillRegistry } from '../core/skills/registry.js';
import { mcpManager } from '../core/mcp/client.js';
import { sessionPersistence } from '../core/agent/persistence.js';
import { listRoles, getRole } from '../core/agent/roles.js';
import { workflowEngine } from '../core/agent/workflows.js';
import { codeIndexer } from '../core/tools/indexer.js';
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
            addSystemMessage(`Switched to agent: ${agentId}`);
          } else {
            addSystemMessage(`Agent not found: ${agentId}`);
          }
          break;
        }

        case 'new': {
          const name = args[0] || `Agent ${agentManager.agents.size + 1}`;
          const agent = agentManager.createAgent({ name });
          agentManager.setActiveAgent(agent.id);
          setActiveAgentId(agent.id);
          addSystemMessage(`Created new agent: ${agent.name} (${agent.id})`);
          break;
        }

        case 'role': {
          const roleKey = args[0];
          if (!roleKey) {
            const roles = listRoles();
            const text = roles.map((r) => `  • ${r.key}: ${r.name} - ${r.description}`).join('\n');
            addSystemMessage(`Available roles:\n${text}`);
            break;
          }
          const role = getRole(roleKey);
          if (role) {
            const name = args[1] || `${role.name} ${agentManager.agents.size + 1}`;
            const agent = agentManager.createAgent({ name, systemPrompt: role.systemPrompt });
            agentManager.setActiveAgent(agent.id);
            setActiveAgentId(agent.id);
            addSystemMessage(`Created ${role.name}: ${agent.name} (${agent.id})`);
          } else {
            addSystemMessage(`Role not found: ${roleKey}. Type /role to list.`);
          }
          break;
        }

        case 'kill': {
          const killId = args[0];
          if (killId && killId !== 'main') {
            agentManager.removeAgent(killId);
            addSystemMessage(`Removed agent: ${killId}`);
          } else {
            addSystemMessage('Cannot remove main agent or invalid id');
          }
          break;
        }

        case 'msg': {
          const [toId, ...contentParts] = args;
          const content = contentParts.join(' ');
          if (toId && content) {
            agentManager.sendAgentMessage(activeAgentId, toId, content);
            addSystemMessage(`Message sent to ${toId}: ${content}`);
          } else {
            addSystemMessage('Usage: /msg <agent-id> <message>');
          }
          break;
        }

        case 'broadcast': {
          const bcontent = args.join(' ');
          agentManager.broadcast(activeAgentId, bcontent);
          addSystemMessage(`Broadcast: ${bcontent}`);
          break;
        }

        case 'delegate': {
          const task = args.join(' ');
          if (task) {
            addSystemMessage(`Delegating task: ${task}`);
            setIsProcessing(true);
            try {
              await agentManager.delegateTask(task);
              addSystemMessage('Task delegation complete');
            } catch (err: any) {
              addSystemMessage(`Delegation failed: ${err.message || String(err)}`);
            }
            setIsProcessing(false);
          } else {
            addSystemMessage('Usage: /delegate <task description>');
          }
          break;
        }

        case 'model': {
          const model = args[0];
          if (model) {
            const provider = configManager.getActiveProvider();
            configManager.updateProvider(provider.name, { defaultModel: model });
            addSystemMessage(`Model set to: ${model}`);
          }
          break;
        }

        case 'provider': {
          const providerName = args[0];
          if (providerName) {
            configManager.setActiveProvider(providerName);
            addSystemMessage(`Provider switched to: ${providerName}`);
          }
          break;
        }

        case 'skill': {
          skillRegistry.init();
          const skillName = args[0];
          if (!skillName) {
            const skills = skillRegistry.list();
            const text = skills.map((s) => `  • ${s.name}: ${s.description}`).join('\n');
            addSystemMessage(`Available skills:\n${text}`);
            break;
          }
          const skill = skillRegistry.get(skillName);
          if (skill) {
            const agent = agentManager.getActiveAgent();
            agent.messages[0] = { role: 'system', content: skill.prompt, agent: agent.name };
            addSystemMessage(`Skill activated: ${skill.name}\n${skill.description}`);
          } else {
            addSystemMessage(`Skill not found: ${skillName}`);
          }
          break;
        }

        case 'review': {
          setIsProcessing(true);
          const target = args[0];
          workflowEngine.reviewCode(target).then((result) => {
            setIsProcessing(false);
            if (result.success) {
              addSystemMessage(`Code review complete. ${result.summary}`);
            } else {
              addSystemMessage(`Review failed: ${result.error}`);
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
              addSystemMessage(`Pair programming started. ${result.summary}`);
            });
          } else {
            addSystemMessage('Usage: /pair <coding task>');
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
                addSystemMessage(`Swarm complete. ${result.summary}`);
              } else {
                addSystemMessage(`Swarm failed: ${result.error}`);
              }
            });
          } else {
            addSystemMessage('Usage: /swarm <glob-pattern> <instruction>');
          }
          break;
        }

        case 'index': {
          setIsProcessing(true);
          codeIndexer.buildIndex().then((count) => {
            setIsProcessing(false);
            const stats = codeIndexer.getStats();
            addSystemMessage(`Indexed ${count} files. Total: ${stats.totalFiles} files, ${(stats.totalSize / 1024).toFixed(1)} KB`);
          });
          break;
        }

        case 'search': {
          const query = args.join(' ');
          if (query) {
            const results = codeIndexer.search(query);
            const text = results.map((r) => `  • ${r.path} (${(r.size / 1024).toFixed(1)} KB)`).join('\n');
            addSystemMessage(`Search results for "${query}":\n${text || 'No matches'}`);
          } else {
            addSystemMessage('Usage: /search <query>');
          }
          break;
        }

        case 'mcp': {
          const mcpCmd = args[0];
          if (mcpCmd === 'list') {
            const servers = mcpManager.getServerNames();
            const text = servers.length ? servers.join('\n') : 'No MCP servers connected';
            addSystemMessage(`MCP Servers:\n${text}`);
          } else if (mcpCmd === 'connect' && args[1]) {
            const serverName = args[1];
            const cfg = configManager.get().mcpServers[serverName];
            if (cfg) {
              mcpManager.connectServer(serverName, cfg)
                .then(() => addSystemMessage(`MCP server connected: ${serverName}`))
                .catch((err: any) => addSystemMessage(`Failed: ${err.message || String(err)}`));
            } else {
              addSystemMessage(`MCP server config not found: ${serverName}`);
            }
          } else {
            addSystemMessage('Usage: /mcp list | /mcp connect <name>');
          }
          break;
        }

        case 'tasks':
          setShowTaskPanel((v) => !v);
          break;

        case 'save': {
          const agent = agentManager.getActiveAgent();
          sessionPersistence.autoSave(agent.id, agent.name, agent.messages, agent.parentAgent);
          addSystemMessage(`Session saved: ${agent.name}`);
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
              addSystemMessage(`Loaded session: ${session.name} (${session.messages.length} messages)`);
            } else {
              addSystemMessage(`Session not found: ${loadId}`);
            }
          } else {
            addSystemMessage('Usage: /load <agent-id>');
          }
          break;
        }

        case 'sessions': {
          const sessions = sessionPersistence.listSessions();
          const text = sessions
            .map((s) => `  • ${s.name} (${s.agentId}) - ${s.messages.length} msgs - ${new Date(s.updatedAt).toLocaleString()}`)
            .join('\n');
          addSystemMessage(text || 'No saved sessions');
          break;
        }

        case 'config': {
          const cfg = configManager.get();
          const provider = configManager.getActiveProvider();
          const text = `
Active Provider: ${cfg.activeProvider}
Base URL: ${provider.baseURL}
Model: ${provider.defaultModel}
Max Tokens: ${cfg.defaultMaxTokens}
Agents: ${agentManager.agents.size}
Debug: ${cfg.debug}
Computer Use: ${cfg.computerUse.enabled}
MCP Servers: ${Object.keys(cfg.mcpServers).join(', ') || 'none'}
          `.trim();
          addSystemMessage(text);
          break;
        }

        default:
          addSystemMessage(`Unknown command: /${cmd}. Type /help for available commands.`);
      }
    },
    [activeAgentId, exit, setShowHelp, setShowAgents, setShowTaskPanel, setIsProcessing, setActiveAgentId, addSystemMessage, deps],
  );

  return { handleCommand };
}
