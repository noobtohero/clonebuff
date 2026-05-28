/**
 * Agent tool execution — handles running tool calls from the AI.
 * The streaming orchestration happens in the App component.
 */

import { resolve } from 'path';
import type { ToolCall, ToolResult } from '../openrouter/types';

/**
 * Execute a single tool call from the AI and return the result.
 */
export async function executeToolCall(
  toolCall: ToolCall,
  projectDir: string,
): Promise<ToolResult> {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
  } catch {
    return {
      toolCallId: toolCall.id,
      name: toolCall.function.name,
      content: `Error: Invalid JSON in tool call arguments: ${toolCall.function.arguments}`,
    };
  }

  switch (toolCall.function.name) {
    case 'read_files': {
      const paths = args['paths'] as string[];
      const results: string[] = [];

      for (const filePath of paths) {
        try {
          const absolutePath = resolvePath(filePath, projectDir);

          if (!isPathWithinProject(absolutePath, projectDir)) {
            results.push(`Error reading ${filePath}: Path is outside the project directory.`);
            continue;
          }

          const file = Bun.file(absolutePath);
          const exists = await file.exists();
          if (!exists) {
            results.push(`Error reading ${filePath}: File not found.`);
            continue;
          }

          const content = await file.text();
          results.push(`=== ${filePath} ===\n${content}`);
        } catch (error) {
          results.push(`Error reading ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      return {
        toolCallId: toolCall.id,
        name: 'read_files',
        content: results.join('\n\n'),
      };
    }

    case 'str_replace': {
      const path = args['path'] as string;
      const replacements = args['replacements'] as Array<{
        oldString: string;
        newString: string;
        allowMultiple?: boolean;
      }>;

      try {
        const absolutePath = resolvePath(path, projectDir);
        if (!isPathWithinProject(absolutePath, projectDir)) {
          return {
            toolCallId: toolCall.id,
            name: 'str_replace',
            content: `Error: Path "${path}" is outside the project directory.`,
          };
        }

        const file = Bun.file(absolutePath);
        const exists = await file.exists();
        if (!exists) {
          return {
            toolCallId: toolCall.id,
            name: 'str_replace',
            content: `Error: File not found: ${path}`,
          };
        }

        let content = await file.text();
        const logs: string[] = [];

        for (const replacement of replacements) {
          if (replacement.allowMultiple) {
            const occurrences = content.split(replacement.oldString).length - 1;
            if (occurrences === 0) {
              logs.push(`Warning: No match found for "${replacement.oldString.slice(0, 50)}..."`);
              continue;
            }
            content = content.replaceAll(replacement.oldString, replacement.newString);
            logs.push(`Replaced ${occurrences} occurrence(s).`);
          } else {
            const idx = content.indexOf(replacement.oldString);
            if (idx === -1) {
              logs.push(`Warning: No match found for "${replacement.oldString.slice(0, 50)}..."`);
              continue;
            }
            content = content.slice(0, idx) + replacement.newString + content.slice(idx + replacement.oldString.length);
            logs.push('Replaced 1 occurrence.');
          }
        }

        await Bun.write(absolutePath, content);
        return {
          toolCallId: toolCall.id,
          name: 'str_replace',
          content: logs.join('\n') || 'No changes made.',
        };
      } catch (error) {
        return {
          toolCallId: toolCall.id,
          name: 'str_replace',
          content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
      }
    }

    case 'write_file': {
      const filePath = args['path'] as string;
      const instructions = (args['instructions'] as string) ?? '';
      const content = args['content'] as string;

      try {
        const absolutePath = resolvePath(filePath, projectDir);
        if (!isPathWithinProject(absolutePath, projectDir)) {
          return {
            toolCallId: toolCall.id,
            name: 'write_file',
            content: `Error: Path "${filePath}" is outside the project directory.`,
          };
        }

        // Create parent directories
        const parentDir = absolutePath.split(/[/\\]/).slice(0, -1).join('/');
        if (parentDir) {
          await Bun.spawn(['mkdir', '-p', parentDir]).exited;
        }

        await Bun.write(absolutePath, content);
        return {
          toolCallId: toolCall.id,
          name: 'write_file',
          content: `✓ Written: ${filePath}\nInstructions: ${instructions}`,
        };
      } catch (error) {
        return {
          toolCallId: toolCall.id,
          name: 'write_file',
          content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
      }
    }

    case 'run_terminal_command': {
      const command = args['command'] as string;
      const description = (args['description'] as string) ?? '';

      try {
        const proc = Bun.spawn(['bash', '-c', command], {
          cwd: projectDir,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        const exitCode = await proc.exited;

        let output = `[Command] ${command}\n`;
        if (description) output += `[Description] ${description}\n`;
        output += `[Exit Code] ${exitCode}\n`;
        if (stdout) output += `[stdout]\n${stdout}\n`;
        if (stderr) output += `[stderr]\n${stderr}\n`;

        return {
          toolCallId: toolCall.id,
          name: 'run_terminal_command',
          content: output,
        };
      } catch (error) {
        return {
          toolCallId: toolCall.id,
          name: 'run_terminal_command',
          content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
      }
    }

    default:
      return {
        toolCallId: toolCall.id,
        name: toolCall.function.name,
        content: `Unknown tool "${toolCall.function.name}". Available: read_files, str_replace, write_file, run_terminal_command.`,
      };
  }
}

function resolvePath(filePath: string, projectDir: string): string {
  // Use path.resolve() to normalize paths and resolve ../ traversal
  const resolved = resolve(projectDir, filePath);
  // Ensure trailing slash for projectDir for proper prefix check
  const normalizedResolved = resolved.replace(/\\/g, '/');
  const normalizedProject = projectDir.replace(/\\/g, '/');
  const projectPrefix = normalizedProject.endsWith('/') ? normalizedProject : normalizedProject + '/';
  return normalizedResolved;
}

function isPathWithinProject(resolvedPath: string, projectDir: string): boolean {
  const normalizedResolved = resolvedPath.replace(/\\/g, '/');
  const normalizedProject = projectDir.replace(/\\/g, '/');
  const projectPrefix = normalizedProject.endsWith('/') ? normalizedProject : normalizedProject + '/';
  return (
    (normalizedResolved === normalizedProject || normalizedResolved.startsWith(projectPrefix)) &&
    !normalizedResolved.includes('/.git/')
  );
}
