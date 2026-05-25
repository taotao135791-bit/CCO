export interface ToolParameter {
  type: string;
  description: string;
  properties?: Record<string, ToolParameter>;
  required?: string[];
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required: string[];
    };
  };
}

export interface ToolResult {
  content: string;
  isError?: boolean;
}

export const BUILT_IN_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'Read',
      description: 'Read the contents of a file with line numbers. Use offset and limit for large files.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Absolute or relative path to the file' },
          offset: { type: 'number', description: 'Line number to start reading from (1-indexed)' },
          limit: { type: 'number', description: 'Maximum number of lines to read' },
        },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Write',
      description: 'Create a new file or overwrite an existing file.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Absolute or relative path to the file' },
          content: { type: 'string', description: 'Full content to write to the file' },
        },
        required: ['file_path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Edit',
      description: 'Make targeted edits to a file. Supports two modes: (1) Line-based: provide start_line and end_line to replace lines by number. (2) Text-based: provide old_string and new_string for exact text replacement. Returns a unified diff preview.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Absolute or relative path to the file' },
          old_string: { type: 'string', description: 'The exact text to replace (text-based mode)' },
          new_string: { type: 'string', description: 'The replacement text' },
          start_line: { type: 'number', description: 'Start line number for line-based replacement (1-indexed)' },
          end_line: { type: 'number', description: 'End line number for line-based replacement (1-indexed, inclusive)' },
        },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'MultiEdit',
      description: 'Make multiple targeted replacements in a single file in one call. Each edit supports line-based (start_line/end_line) or text-based (old_string/new_string) mode.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Absolute or relative path to the file' },
          edits: {
            type: 'array',
            description: 'Array of edit operations',
            items: {
              type: 'object',
              properties: {
                old_string: { type: 'string', description: 'The exact text to replace (text-based mode)' },
                new_string: { type: 'string', description: 'The replacement text' },
                start_line: { type: 'number', description: 'Start line number (1-indexed)' },
                end_line: { type: 'number', description: 'End line number (1-indexed, inclusive)' },
              },
            },
          },
        },
        required: ['file_path', 'edits'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Bash',
      description: 'Execute a bash command in the terminal. Use with caution.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The bash command to execute' },
          timeout: { type: 'number', description: 'Timeout in milliseconds (default 30000)' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Glob',
      description: 'Find files matching a glob pattern.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern like "src/**/*.ts"' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'WebSearch',
      description: 'Search the web for information.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'WebFetch',
      description: 'Fetch content from a URL.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to fetch' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'NotebookRead',
      description: 'Read a Jupyter notebook file (.ipynb).',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Path to the .ipynb file' },
        },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'NotebookEdit',
      description: 'Edit a Jupyter notebook file.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Path to the .ipynb file' },
          cell_index: { type: 'number', description: 'Index of the cell to edit' },
          new_source: { type: 'string', description: 'New cell source content' },
        },
        required: ['file_path', 'cell_index', 'new_source'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Grep',
      description: 'Search for a pattern in files. Returns matching lines with context. Uses regex.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern to search for' },
          path: { type: 'string', description: 'File or directory to search in (default: current directory)' },
          include: { type: 'string', description: 'Glob pattern to filter files (e.g. "*.ts", "*.{js,jsx}")' },
          context_lines: { type: 'number', description: 'Number of context lines before/after each match (default: 2)' },
          case_insensitive: { type: 'boolean', description: 'Case-insensitive search (default: false)' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'LS',
      description: 'List directory contents. Shows files and folders with sizes.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path to list (default: current directory)' },
          recursive: { type: 'boolean', description: 'List recursively (default: false)' },
          max_depth: { type: 'number', description: 'Maximum depth for recursive listing (default: 3)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'TodoWrite',
      description: 'Create and manage a structured todo/task list for tracking multi-step work. Use merge=true to update existing items, merge=false to replace.',
      parameters: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            description: 'Array of todo items',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Unique identifier for the todo item' },
                content: { type: 'string', description: 'Description of the task' },
                status: { type: 'string', enum: ['PENDING', 'IN_PROGRESS', 'COMPLETE', 'CANCELLED'], description: 'Current status' },
              },
              required: ['id', 'content', 'status'],
            },
          },
          merge: { type: 'boolean', description: 'If true, merge with existing todos by id. If false, replace all. (default: true)' },
        },
        required: ['todos'],
      },
    },
  },
];

// Computer Use tools (only enabled when config.computerUse.enabled is true)
export const COMPUTER_USE_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'ComputerScreenshot',
      description: 'Take a screenshot of the current screen.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ComputerClick',
      description: 'Click at specific screen coordinates.',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number', description: 'X coordinate' },
          y: { type: 'number', description: 'Y coordinate' },
        },
        required: ['x', 'y'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ComputerType',
      description: 'Type text at the current cursor position.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to type' },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ComputerKey',
      description: 'Press a keyboard key.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Key name (enter, escape, tab, space, backspace, up, down, left, right)' },
        },
        required: ['key'],
      },
    },
  },
];
