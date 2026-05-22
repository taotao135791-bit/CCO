import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ToolDefinition } from '../tools/definitions.js';

export interface MCPServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export class MCPClientManager {
  private clients: Map<string, { client: Client; transport: StdioClientTransport }> = new Map();
  private tools: Map<string, ToolDefinition[]> = new Map();

  async connectServer(name: string, config: MCPServerConfig): Promise<void> {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: { ...process.env, ...config.env } as Record<string, string>,
    });

    const client = new Client({ name: 'cco-client', version: '0.1.0' }, { capabilities: {} });
    await client.connect(transport);

    // List tools
    const toolsResponse = await client.listTools();
    const toolDefs: ToolDefinition[] = toolsResponse.tools.map((t) => ({
      type: 'function',
      function: {
        name: `mcp_${name}_${t.name}`,
        description: t.description || '',
        parameters: t.inputSchema as any,
      },
    }));

    this.clients.set(name, { client, transport });
    this.tools.set(name, toolDefs);
  }

  async disconnectServer(name: string): Promise<void> {
    const entry = this.clients.get(name);
    if (entry) {
      await entry.transport.close();
      this.clients.delete(name);
      this.tools.delete(name);
    }
  }

  getAllTools(): ToolDefinition[] {
    const all: ToolDefinition[] = [];
    for (const [, tools] of this.tools) {
      all.push(...tools);
    }
    return all;
  }

  async callTool(serverName: string, toolName: string, args: Record<string, any>): Promise<string> {
    const entry = this.clients.get(serverName);
    if (!entry) throw new Error(`MCP server ${serverName} not connected`);

    const result = await entry.client.callTool({ name: toolName, arguments: args });
    return JSON.stringify(result);
  }

  getServerNames(): string[] {
    return Array.from(this.clients.keys());
  }
}

export const mcpManager = new MCPClientManager();
