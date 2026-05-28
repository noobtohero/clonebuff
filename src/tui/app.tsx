/**
 * Main App component — orchestrates the Clonebuff CLI experience.
 *
 * Manages:
 *  - API key setup flow
 *  - Conversation state (with system prompt)
 *  - Streaming responses with multi-turn tool call handling
 *  - Parallel tool execution with real-time status
 *  - Checkpoint system (save, list, restore)
 *  - Auto-checkpoint before tool calls
 *  - Error handling and recovery
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useApp } from 'ink';
import { Input } from './input';
import { Messages, type ToolExecutionStatus } from './messages';
import { Spinner } from './components/spinner';
import { StatusBar } from './components/status-bar';
import { OpenRouterClient, getDefaultTools, toOpenRouterMessages } from '../openrouter/client';
import { executeToolCall } from '../agent/core';
import { getSystemMessage } from '../agent/prompts';
import { loadCharacter, saveCharacter, DEFAULT_CHARACTER, type AgentCharacter } from '../agent/character';
import { loadConfig, getProjectDir, saveApiKey, saveConfig } from '../config/loader';
import type { ClonebuffConfig } from '../config/defaults';
import { DEFAULTS } from '../config/defaults';
import { getWelcomeMessage } from '../config/setup';
import { CheckpointManager } from '../checkpoint/manager';
import { ContextManager } from '../agent/context';
import type { ConversationMessage, ToolResult, PendingToolChange } from '../openrouter/types';
import { previewToolChange } from './diff';
import { ConfirmationPrompt } from './components/confirmation-prompt';
import { SessionManager } from '../session/manager';
import type { SessionEntry } from '../session/types';
import { runInit, runFullInit } from '../config/init';

type AppPhase = 'loading' | 'setup' | 'ready' | 'processing';

export function App() {
  const { exit } = useApp();
  const projectDir = getProjectDir();

  // ─── State ────────────────────────────────────────────────────────────────

  const [phase, setPhase] = useState<AppPhase>('loading');
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [config, setConfig] = useState<ClonebuffConfig>(DEFAULTS);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toolStatus, setToolStatus] = useState<ToolExecutionStatus | null>(null);
  const [character, setCharacter] = useState<AgentCharacter>(DEFAULT_CHARACTER);
  const [turnInfo, setTurnInfo] = useState<{ currentTurn: number; maxTurns: number } | null>(null);

  // Setup flow state
  const [setupStep, setSetupStep] = useState<'welcome' | 'ask_key' | 'ask_save' | 'done'>('welcome');
  const [setupKey, setSetupKey] = useState('');
  const [setupMessages, setSetupMessages] = useState<string[]>([]);

  // Checkpoint manager
  const checkpointManagerRef = useRef<CheckpointManager>(new CheckpointManager(projectDir));

  // Initialize checkpoint mode from manager
  useEffect(() => {
    setCheckpointMode(checkpointManagerRef.current.mode);
  }, []);

  // Context manager (compaction tracking)
  // Context manager (compaction tracking)
  const contextManagerRef = useRef<ContextManager>(new ContextManager());

  // Checkpoint mode for status bar
  const [checkpointMode, setCheckpointMode] = useState('snapshot');

  // Pending changes for diff confirmation
  const [pendingChanges, setPendingChanges] = useState<PendingToolChange[] | null>(null);

  // Command/prompt history for up/down arrow recall
  const [promptHistory, setPromptHistory] = useState<string[]>([]);

  // Refs for current state (to avoid stale closures in async callbacks)
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const systemMessageRef = useRef<ConversationMessage | null>(null);

  // Refs for continuation after user confirmation
  const pendingContinuationRef = useRef<{
    toolCalls: import('../openrouter/types').ToolCall[];
    messages: ConversationMessage[];
    turnCount: number;
  } | null>(null);

  // Session manager for conversation persistence
  const sessionManagerRef = useRef<SessionManager>(new SessionManager(projectDir));
  const currentSessionIdRef = useRef<string | null>(null);

  // Usage tracking (tokens consumed, API calls)
  const usageRef = useRef({
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    apiCalls: 0,
    model: config.model,
  });
  // Keep the model name in sync
  usageRef.current.model = config.model;

  const confirmationsDisabledRef = useRef(false);

  // ─── Character command handler ──────────────────────────────────────────────

  const handleCharacterCommand = useCallback((input: string) => {
    const cmd = input.toLowerCase().trim();

    // /character — show current character
    if (cmd === '/character') {
      const lines = [
        `## ${character.emoji} Current Character`,
        '',
        `**Name:**         ${character.name}`,
        `**Emoji:**        ${character.emoji}`,
        `**Color:**        ${character.color}`,
        `**Personality:**  ${character.personality}`,
        `**Catchphrase:**  ${character.catchphrase}`,
        `**Tags:**         ${character.tags.join(', ')}`,
        `**Backstory:**    ${character.backstory}`,
        '',
        'To customize:',
        '  `/character set name <new name>`',
        '  `/character set emoji <emoji>`',
        '  `/character set color <color>`',
        '  `/character set personality <text>`',
        '  `/character set catchphrase <text>`',
        '  `/character reset` — restore default character',
      ];
      const msg: ConversationMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        role: 'assistant',
        content: lines.join('\n'),
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, msg]);
      return true;
    }

    // /character set ...
    if (cmd.startsWith('/character set ')) {
      const rest = input.slice('/character set '.length).trim();
      const spaceIdx = rest.indexOf(' ');
      const field = spaceIdx >= 0 ? rest.slice(0, spaceIdx).toLowerCase() : rest.toLowerCase();
      const value = spaceIdx >= 0 ? rest.slice(spaceIdx + 1).trim() : '';

      if (!value) {
        const errMsg: ConversationMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          role: 'assistant',
          content: `Usage: \`/character set ${field} <value>\` — provide a value for ${field}.`,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, errMsg]);
        return true;
      }

      const allowedFields = ['name', 'emoji', 'color', 'personality', 'catchphrase'];
      if (!allowedFields.includes(field)) {
        const errMsg: ConversationMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          role: 'assistant',
          content: `Unknown field \`${field}\`. Allowed: ${allowedFields.join(', ')}`,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, errMsg]);
        return true;
      }

      const update: Partial<AgentCharacter> = { [field]: value };
      const result = saveCharacter(update);

      if (result.success) {
        setCharacter(result.character);
        // Update system prompt with new character
        if (projectDir) {
          systemMessageRef.current = getSystemMessage(projectDir, result.character);
        }
        const msg: ConversationMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          role: 'assistant',
          content: `✓ **${field}** changed to: ${value}\nCharacter saved to ~/.clonebuff/character.json`,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, msg]);
      } else {
        const errMsg: ConversationMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          role: 'assistant',
          content: `✗ Failed to save: ${result.error}`,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, errMsg]);
      }
      return true;
    }

    // /character reset
    if (cmd === '/character reset') {
      const result = saveCharacter(DEFAULT_CHARACTER);
      if (result.success) {
        setCharacter(result.character);
        if (projectDir) {
          systemMessageRef.current = getSystemMessage(projectDir, result.character);
        }
        const msg: ConversationMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          role: 'assistant',
          content: `✓ Character reset to default: ${DEFAULT_CHARACTER.emoji} ${DEFAULT_CHARACTER.name}`,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, msg]);
      } else {
        const errMsg: ConversationMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          role: 'assistant',
          content: `✗ Failed to reset: ${result.error}`,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, errMsg]);
      }
      return true;
    }

    return false;
  }, [character, projectDir]);

  // ─── Checkpoint command handler ───────────────────────────────────────────

  // ─── Init ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    const { apiKey: key, config: loadedConfig } = loadConfig(projectDir);

    // Load character
    const loadedChar = loadCharacter();
    setCharacter(loadedChar);

    // Build the system prompt — tells the AI about its capabilities and project context
    systemMessageRef.current = getSystemMessage(projectDir, loadedChar);

    if (key) {
      setApiKey(key);
      setConfig(loadedConfig);
      // Reload character in case default changed
      const charData = loadCharacter();
      setCharacter(charData);
      // Rebuild system message with character
      systemMessageRef.current = getSystemMessage(projectDir, charData);
      setPhase('ready');

      // Show a tip about the most recent saved session
      const latest = sessionManagerRef.current.loadLatest();
      if (latest && latest.messageCount > 0) {
        const time = new Date(latest.updatedAt).toLocaleString();
        const tip: ConversationMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          role: 'assistant',
          content: `📂 Previous session found: "${latest.preview}"\n  ${time} — ${latest.messageCount} messages, model: ${latest.model}\n  Type \`/session load ${latest.id}\` to restore it.`,
          timestamp: Date.now(),
        };
        setMessages([tip]);
      }
    } else {
      setPhase('setup');
      setSetupMessages([
        '🚀 Welcome to Clonebuff!',
        '',
        'Clonebuff needs an OpenRouter API key to work.',
        'Get your free key at: https://openrouter.ai/keys',
        '',
        'Paste your OpenRouter API key:',
      ]);
      setSetupStep('ask_key');
    }
  }, [projectDir]);

  // ─── Setup handlers ───────────────────────────────────────────────────────

  const handleSetupSubmit = useCallback(async (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return;

    if (setupStep === 'ask_key') {
      setSetupKey(trimmed);
      setSetupMessages((prev) => [
        ...prev,
        `> ${trimmed}`,
        '',
        'Validating API key...',
      ]);
      setSetupStep('ask_save');

      const client = new OpenRouterClient({ apiKey: trimmed });
      const isValid = await client.validateApiKey();

      if (isValid) {
        setSetupMessages((prev) => [
          ...prev.slice(0, -1),
          'Validating API key... ✓',
          '',
          'Where to save your API key?',
          '  1) Project (.env.local)',
          '  2) Global (~/.clonebuff/config.json)',
          "  3) Don't save (use env variable)",
          '',
          'Enter 1, 2, or 3:',
        ]);
        setSetupStep('ask_save');
      } else {
        setSetupMessages((prev) => [
          ...prev.slice(0, -1),
          '✗ Invalid API key. Please check and try again.',
          '',
          'Paste your OpenRouter API key:',
        ]);
        setSetupStep('ask_key');
      }
    } else if (setupStep === 'ask_save') {
      const choice = trimmed.trim();
      if (choice === '1') {
        saveApiKey(setupKey, 'project', projectDir);
        setSetupMessages((prev) => [
          ...prev,
          '> 1',
          'Saved to .env.local ✓',
        ]);
      } else if (choice === '2') {
        saveApiKey(setupKey, 'global', projectDir);
        setSetupMessages((prev) => [
          ...prev,
          '> 2',
          'Saved to ~/.clonebuff/config.json ✓',
        ]);
      } else {
        setSetupMessages((prev) => [
          ...prev,
          `> ${choice}`,
          'OK, you can set OPENROUTER_API_KEY env variable later.',
        ]);
      }

      setSetupMessages((prev) => [
        ...prev,
        '',
        getWelcomeMessage(config.model),
        '',
      ]);
      setApiKey(setupKey);
      setPhase('ready');
    }
  }, [setupStep, setupKey, config.model, projectDir]);

  // ─── Auto-checkpoint ──────────────────────────────────────────────────────

  const createAutoCheckpoint = useCallback(async (): Promise<string | null> => {
    if (!config.checkpointsEnabled || !config.autoCheckpoint) return null;

    try {
      const result = await checkpointManagerRef.current.create({
        description: 'Auto-checkpoint before AI edits',
      });
      if (result.success) {
        return `✓ Auto-checkpoint saved: ${result.entry.id} (${checkpointManagerRef.current.mode})`;
      }
      return `⚠ Auto-checkpoint failed: ${result.error ?? 'Unknown error'}`;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return `⚠ Auto-checkpoint error: ${msg}`;
    }
  }, [config.checkpointsEnabled, config.autoCheckpoint]);

  // ─── Main agent loop ─────────────────────────────────────────────────────

  const handleSubmit = useCallback(async (prompt: string) => {
    if (!apiKey) return;

    // Auto-save the previous conversation before starting a new request
    if (messagesRef.current.length > 0) {
      autoSaveSession();
    }

    setPhase('processing');
    setErrorMessage(null);
    setStreamingText('');
    setToolStatus(null);

    const client = new OpenRouterClient({
      apiKey,
      providerPreference: config.providerPreference,
    });

    // Add user message to the conversation
    const userMessage: ConversationMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);

    // Build the message array for the API:
    //   [system message] + [previous messages] + [new user message]
    const systemMsg = systemMessageRef.current;
    let currentMessages: ConversationMessage[] = [];
    if (systemMsg) {
      currentMessages.push(systemMsg);
    }
    currentMessages = currentMessages.concat(messagesRef.current, userMessage);

    // Auto-compact if approaching the context window limit
    if (config.contextCompactionEnabled) {
      const compactResult = contextManagerRef.current.compact(
        currentMessages,
        {
          model: config.model,
          responseBudget: config.responseBudget,
          preserveRecentTurns: config.preserveRecentTurns,
          enabled: true,
        },
      );

      if (compactResult.wasCompacted) {
        // Use the compacted messages for the API call
        currentMessages = compactResult.messages;
        // The user sees a brief notification (the compaction summary is role=system, so it's filtered from the UI)
        const stats = contextManagerRef.current.getStats();
        if (stats.lastSavings && stats.lastSavings > 1000) {
          const cpNotice: ConversationMessage = {
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            role: 'assistant',
            content: `📐 Context compacted (saved ~${Math.round(stats.lastSavings / 1000)}k tokens)`,
            timestamp: Date.now(),
          };
          setMessages((prev) => [...prev, cpNotice]);
        }
      }
    }

    const MAX_TURNS = 10;
    let turnCount = 0;
    let hasAutoCheckpointed = false;

    while (turnCount < MAX_TURNS) {
      turnCount++;
      setTurnInfo({ currentTurn: turnCount, maxTurns: MAX_TURNS });
      setStatusMessage(turnCount > 1 ? `Turn ${turnCount} of ${MAX_TURNS}` : '');

      try {
        const result = await client.streamChat(
          {
            model: config.model,
            messages: toOpenRouterMessages(currentMessages),
            tools: getDefaultTools(),
            tool_choice: 'auto',
            temperature: config.temperature,
            max_tokens: config.maxTokens,
            // Provider routing via OpenRouterClient constructor handles cache stickiness
          },
          (token: string) => {
            setStreamingText((prev) => prev + token);
          },
        );

        // Track usage from this API call
        if (result.usage) {
          usageRef.current.promptTokens += result.usage.promptTokens;
          usageRef.current.completionTokens += result.usage.completionTokens;
          usageRef.current.totalTokens += result.usage.totalTokens;
        }
        usageRef.current.apiCalls++;
        usageRef.current.model = config.model;

        if (result.toolCalls.length > 0) {
          // ── The model wants to call tools ──────────────────────────

          // Auto-checkpoint before first tool execution
          if (!hasAutoCheckpointed) {
            hasAutoCheckpointed = true;
            const cpResult = await createAutoCheckpoint();
            if (cpResult) {
              const cpMsg: ConversationMessage = {
                id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
                role: 'assistant',
                content: cpResult,
                timestamp: Date.now(),
              };
              setMessages((prev) => [...prev, cpMsg]);
            }
          }

          // Record the assistant message that requested tool calls
          const assistantMsg: ConversationMessage = {
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            role: 'assistant',
            content: result.content || '',
            toolCalls: result.toolCalls,
            timestamp: Date.now(),
          };

          setMessages((prev) => [...prev, assistantMsg]);
          setStreamingText('');

          // ── Confirmation check ─────────────────────────────────────
          // If diff confirmation is enabled, generate previews and wait for user input
          if (config.confirmChanges && !confirmationsDisabledRef.current) {
            const changes = await generatePreviews(result.toolCalls);

            pendingContinuationRef.current = {
              toolCalls: result.toolCalls,
              messages: [...currentMessages, assistantMsg],
              turnCount,
            };

            setPendingChanges(changes);
            setPhase('ready');
            return;
          }

          // ── Execute all tool calls in parallel ─────────────────────
          setToolStatus({
            currentTool: result.toolCalls[0]!.function.name,
            message: result.toolCalls.length === 1 ? 'Executing tool...' : `Executing ${result.toolCalls.length} tools...`,
            completed: [],
          });

          const { toolResults, completed } = await executeTools(result.toolCalls);

          setToolStatus({
            currentTool: '',
            message: 'All tools complete',
            completed,
          });

          const toolResultMessages: ConversationMessage[] = toolResults.map((tr) => ({
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            role: 'tool',
            content: tr.content,
            toolCallId: tr.toolCallId,
            name: tr.name,
            timestamp: Date.now(),
          }));

          setMessages((prev) => [...prev, ...toolResultMessages]);
          currentMessages = [...currentMessages, assistantMsg, ...toolResultMessages];

          setToolStatus(null);
        } else {
          // ── Text response — done with tools ────────────────────────

          const assistantMsg: ConversationMessage = {
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            role: 'assistant',
            content: result.content,
            timestamp: Date.now(),
          };

          setStreamingText('');
          setMessages((prev) => [...prev, assistantMsg]);
          setStatusMessage('');
          setTurnInfo(null);
          setPhase('ready');
          return;
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        setErrorMessage(msg);
        setStatusMessage('');
        setTurnInfo(null);
        setPhase('ready');
        return;
      }
    }

    // Max turns reached — model kept requesting tools without producing a text response
    setTurnInfo(null);
    setErrorMessage(
      'Reached maximum tool call turns (10). The model is using too many tool cycles. ' +
      'Try simplifying your request or breaking it into smaller steps.',
    );
    setPhase('ready');
  }, [apiKey, config, projectDir, createAutoCheckpoint]);

  // ─── Checkpoint command handler ───────────────────────────────────────────

  const handleCheckpointCommand = useCallback(async (
    subcommand: string,
    args: string,
  ): Promise<boolean> => {
    const checkpointManager = checkpointManagerRef.current;

    if (subcommand === 'save') {
      const name = args || '';

      // Add a status message showing we're creating a checkpoint
      const creatingMsg: ConversationMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        role: 'assistant',
        content: `Saving checkpoint (${checkpointManager.mode})...`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, creatingMsg]);

      const result = await checkpointManager.create({ name: name || undefined });

      let resultContent: string;
      if (result.success) {
        const nameInfo = name ? ` "${name}"` : '';
        resultContent = [
          `✓ Checkpoint saved${nameInfo}: \`${result.entry.id}\``,
          `  Mode: ${result.entry.mode}`,
          `  Time: ${new Date(result.entry.timestamp).toLocaleString()}`,
        ].join('\n');
      } else {
        resultContent = `✗ Failed to save checkpoint: ${result.error ?? 'Unknown error'}`;
      }

      // Replace the "saving" message with the result
      setMessages((prev) => {
        const updated = [...prev];
        if (updated.length > 0) {
          updated[updated.length - 1] = {
            ...updated[updated.length - 1]!,
            content: resultContent,
          };
        }
        return updated;
      });

      return true;
    }

    if (subcommand === 'list' || subcommand === 'ls') {
      setStatusMessage('Listing checkpoints...');

      const entries = await checkpointManager.list();

      setStatusMessage('');

      let content: string;
      if (entries.length === 0) {
        content = 'No checkpoints found. Use `/checkpoint save` to create one.';
      } else {
        const lines: string[] = [`Found ${entries.length} checkpoint(s) (${checkpointManager.mode} mode):`, ''];
        for (const entry of entries) {
          const time = new Date(entry.timestamp).toLocaleString();
          const nameInfo = entry.name ? ` "${entry.name}"` : '';
          lines.push(`  \`${entry.id}\`${nameInfo}`);
          lines.push(`    ${time} — ${entry.mode}${entry.description ? ` — ${entry.description}` : ''}`);
        }
        lines.push('');
        lines.push(`To restore: \`/checkpoint restore <id>\``);
        content = lines.join('\n');
      }

      const listMsg: ConversationMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        role: 'assistant',
        content,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, listMsg]);
      return true;
    }

    if (subcommand === 'restore') {
      const id = args.trim();
      if (!id) {
        const errMsg: ConversationMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          role: 'assistant',
          content: 'Usage: `/checkpoint restore <id>` — provide a checkpoint ID to restore.',
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, errMsg]);
        return true;
      }

      // Show restoring status
      const restoringMsg: ConversationMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        role: 'assistant',
        content: `Restoring checkpoint \`${id}\`...`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, restoringMsg]);

      setStatusMessage(`Restoring checkpoint ${id}...`);

      const result = await checkpointManager.restore(id);

      setStatusMessage('');

      let resultContent: string;
      if (result.success) {
        resultContent = `✓ Checkpoint \`${id}\` restored successfully.\n${result.details ?? ''}`;
      } else {
        resultContent = `✗ Failed to restore checkpoint \`${id}\`: ${result.error ?? 'Unknown error'}`;
      }

      // Replace the "restoring" message with the result
      setMessages((prev) => {
        const updated = [...prev];
        if (updated.length > 0) {
          updated[updated.length - 1] = {
            ...updated[updated.length - 1]!,
            content: resultContent,
          };
        }
        return updated;
      });

      return true;
    }

    return false;
  }, []);

  // ─── Clear pending changes when clearing conversation ─────────────────────

  const onClear = useCallback(() => {
    // Auto-save before clearing
    if (messagesRef.current.length > 0) {
      autoSaveSession();
    }
    setMessages([]);
    setStreamingText('');
    setErrorMessage(null);
    setToolStatus(null);
    setTurnInfo(null);
    setPendingChanges(null);
    pendingContinuationRef.current = null;
    confirmationsDisabledRef.current = false;
    contextManagerRef.current.reset();
    usageRef.current = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      apiCalls: 0,
      model: config.model,
    };
  }, []);
  // Note: autoSaveSession uses config.model via closure, but since it reads
  // from messagesRef.current (always fresh) and only writes model as metadata,
  // a stale model value on /clear is a minor cosmetic issue, not a data bug.

  // ─── Command handler ──────────────────────────────────────────────────────

  const handleCommand = useCallback((input: string) => {
    const cmd = input.toLowerCase().trim();

    if (cmd === '/exit') {
      // Auto-save before exiting
      if (messagesRef.current.length > 0) {
        autoSaveSession();
      }
      exit();
      return true;
    }

    if (cmd === '/clear') {
      onClear();
      return true;
    }

    if (cmd === '/usage') {
      const u = usageRef.current;

      // Estimate cost based on model family
      const costPer1M = estimateTokenCost(config.model);
      const promptCost = (u.promptTokens / 1_000_000) * costPer1M.input;
      const completionCost = (u.completionTokens / 1_000_000) * costPer1M.output;
      const totalCost = promptCost + completionCost;

      const lines: string[] = [
        '## Usage (this session)',
        '',
        `**Model:**            ${u.model}`,
        `**API calls:**        ${u.apiCalls}`,
        '',
        `**Prompt tokens:**    ${u.promptTokens.toLocaleString()}`,
        `**Completion tokens:** ${u.completionTokens.toLocaleString()}`,
        `**Total tokens:**     ${u.totalTokens.toLocaleString()}`,
        '',
      ];

      if (u.apiCalls > 0) {
        const avgPromptCompletion = u.apiCalls > 0
          ? Math.round(u.promptTokens / u.apiCalls)
          : 0;
        const avgOutput = u.apiCalls > 0
          ? Math.round(u.completionTokens / u.apiCalls)
          : 0;
        lines.push(`**Avg input/call:**   ${avgPromptCompletion.toLocaleString()} tokens`);
        lines.push(`**Avg output/call:**  ${avgOutput.toLocaleString()} tokens`);
        lines.push('');

        if (totalCost > 0.001) {
          const costStr = totalCost < 0.01
            ? `~$${totalCost.toFixed(4)}`
            : `~$${totalCost.toFixed(3)}`;
          lines.push(`**Est. cost:**        ${costStr} (@ $${costPer1M.input}/1M in, $${costPer1M.output}/1M out)`);
        } else {
          lines.push('**Est. cost:**        < $0.001');
        }
      } else {
        lines.push('No API calls made yet in this session.');
      }

      const msg: ConversationMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        role: 'assistant',
        content: lines.join('\n'),
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, msg]);
      return true;
    }

    if (cmd.startsWith('/character')) {
      handleCharacterCommand(input);
      return true;
    }

    if (cmd === '/help') {
      const sessionCount = sessionManagerRef.current.count();
      const u = usageRef.current;

      const helpMsg: ConversationMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        role: 'assistant',
        content: [
          '## Clonebuff Commands',
          '',
          '  `/help`                   Show this help message',
          '  `/clear`                  Clear the conversation',
          '  `/usage`                  Show token usage and estimated cost',
          '  `/session save [name]`    Save current conversation',
          '  `/session list`           List saved conversations',
          '  `/session load <id>`      Load a saved conversation',
          '  `/model <slug>`           Switch AI model (persisted)',
          '  `/temperature <0-2>`      Set temperature (persisted)',
          '  `/config show`            Display current configuration',
          '  `/config toggle confirm`  Toggle diff preview on/off (persisted)',
          '  `/init`                   Scaffold project config files (knowledge.md, .agents/types)',
          '  `/checkpoint save [name]` Save a checkpoint of current codebase state',
          '  `/checkpoint list`        List saved checkpoints',
          '  `/checkpoint restore <id>` Restore codebase to a checkpoint state',
          '  `/character`              View or customize AI character',
          '  `/character set <field> <value>`  Change name, emoji, color, personality, catchphrase',
          '  `/character reset`        Restore default character',
          '  `/exit`                   Exit Clonebuff',
          '',
          'Just type anything to start a conversation with the AI.',
          '',
          'The AI has access to these tools:',
          '  📖 `read_files`           Read files from your project',
          '  ✏️ `str_replace`          Make precise edits to files',
          '  📝 `write_file`           Create new files or overwrite existing ones',
          '  ⚡ `run_terminal_command`  Execute shell commands',
          '',
          `Checkpoint mode: ${checkpointManagerRef.current.mode}`,
          `Model: ${config.model}`,
          `Temperature: ${config.temperature}`,
          `Diff confirmation: ${config.confirmChanges ? 'on' : 'off'}`,
          `Saved sessions: ${sessionCount}`,
          `Tokens used: ${u.totalTokens.toLocaleString()} (${u.apiCalls} API calls)`,
        ].join('\n'),
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, helpMsg]);
      return true;
    }

    if (cmd.startsWith('/model ')) {
      const model = cmd.slice(7).trim();
      if (model) {
        const saved = saveConfig({ model });
        setConfig((prev) => ({ ...prev, model }));
        const status = saved ? '✓ Saved to ~/.clonebuff/config.json' : '⚠ Could not persist — will reset on restart';
        const msg: ConversationMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          role: 'assistant',
          content: `Model changed to **\`${model}\`** ${status}`,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, msg]);
      }
      return true;
    }

    if (cmd.startsWith('/temperature ') || cmd.startsWith('/temp ')) {
      const valueStr = cmd.slice('/temperature '.length).trim();
      const temperature = parseFloat(valueStr);
      if (isNaN(temperature) || temperature < 0 || temperature > 2) {
        const errMsg: ConversationMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          role: 'assistant',
          content: 'Usage: `/temperature <0.0–2.0>` — provide a value between 0 and 2.',
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, errMsg]);
      } else {
        const rounded = Math.round(temperature * 100) / 100;
        const saved = saveConfig({ temperature: rounded });
        setConfig((prev) => ({ ...prev, temperature: rounded }));
        const status = saved ? '✓ Saved' : '⚠ Not persisted';
        const msg: ConversationMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          role: 'assistant',
          content: `Temperature set to **${rounded}** ${status}`,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, msg]);
      }
      return true;
    }

    if (cmd.startsWith('/config ')) {
      const rest = cmd.slice('/config '.length).trim();

      // /config toggle confirmChanges
      if (rest === 'toggle confirmChanges' || rest === 'toggle confirm') {
        const newVal = !config.confirmChanges;
        const saved = saveConfig({ confirmChanges: newVal });
        setConfig((prev) => ({ ...prev, confirmChanges: newVal }));
        const status = saved ? '✓ Saved' : '⚠ Not persisted';
        const msg: ConversationMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          role: 'assistant',
          content: `Diff confirmation **${newVal ? 'enabled' : 'disabled'}** ${status}`,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, msg]);
        return true;
      }

      // /config show — display current config
      if (rest === 'show') {
        const lines = [
          '## Current Configuration',
          '',
          `**model**            \`${config.model}\``,
          `**temperature**      ${config.temperature}`,
          `**confirmChanges**   ${config.confirmChanges}`,
          `**checkpoints**      ${config.checkpointsEnabled ? 'enabled' : 'disabled'}`,
          `**contextCompact**   ${config.contextCompactionEnabled ? 'enabled' : 'disabled'}`,
          `**maxTokens**        ${config.maxTokens}`,
          `**provider**         ${config.providerPreference || '(auto)'}`,
          '',
          'To change:',
          '  `/model <slug>`         Switch model (persisted)',
          '  `/temperature <0-2>`    Set temperature (persisted)',
          '  `/config toggle confirmChanges`  Toggle diff preview (persisted)',
        ];
        const msg: ConversationMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          role: 'assistant',
          content: lines.join('\n'),
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, msg]);
        return true;
      }

      // Unknown /config subcommand
      const errMsg: ConversationMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        role: 'assistant',
        content: [
          'Usage: `/config <subcommand>`',
          '',
          '  `/config show`                      Display current configuration',
          '  `/config toggle confirmChanges`      Toggle diff preview on/off',
          '',
          'Also available:',
          '  `/model <slug>`         Set AI model (persisted)',
          '  `/temperature <0-2>`    Set temperature (persisted)',
        ].join('\n'),
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errMsg]);
      return true;
    }

    if (cmd.startsWith('/session ')) {
      const rest = cmd.slice('/session '.length).trim();
      const spaceIdx = rest.indexOf(' ');
      const subcommand = spaceIdx >= 0 ? rest.slice(0, spaceIdx) : rest;
      const args = spaceIdx >= 0 ? rest.slice(spaceIdx + 1).trim() : '';

      if (subcommand === 'save') {
        // Save with optional name
        autoSaveSession(args || undefined);
        const sid = currentSessionIdRef.current;
        const nameInfo = args ? ` "${args}"` : '';
        const msg: ConversationMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          role: 'assistant',
          content: `✓ Session saved${nameInfo} \`${sid}\``,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, msg]);
        return true;
      }

      if (subcommand === 'list' || subcommand === 'ls') {
        const sessions = sessionManagerRef.current.list();
        if (sessions.length === 0) {
          const msg: ConversationMessage = {
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            role: 'assistant',
            content: 'No saved sessions found. Sessions are auto-saved when you start a new prompt or use `/clear`.',
            timestamp: Date.now(),
          };
          setMessages((prev) => [...prev, msg]);
        } else {
          const lines: string[] = [`Found ${sessions.length} saved session(s):`, ''];
          for (const s of sessions.slice(0, 20)) {
            const time = new Date(s.updatedAt).toLocaleString();
            lines.push(`  \`${s.id}\``);
            lines.push(`    ${s.name}`);
            lines.push(`    ${time} — ${s.model} — ${s.messageCount} msgs`);
          }
          if (sessions.length > 20) {
            lines.push(`  ... and ${sessions.length - 20} more`);
          }
          lines.push('');
          lines.push('To load: `/session load <id>`    To delete: `/session delete <id>`');
          const msg: ConversationMessage = {
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            role: 'assistant',
            content: lines.join('\n'),
            timestamp: Date.now(),
          };
          setMessages((prev) => [...prev, msg]);
        }
        return true;
      }

      if (subcommand === 'load') {
        const sid = args.trim();
        if (!sid) {
          const msg: ConversationMessage = {
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            role: 'assistant',
            content: 'Usage: `/session load <id>` — provide a session ID to load. Use `/session list` to find one.',
            timestamp: Date.now(),
          };
          setMessages((prev) => [...prev, msg]);
          return true;
        }

        const entry = sessionManagerRef.current.load(sid);
        if (!entry) {
          const msg: ConversationMessage = {
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            role: 'assistant',
            content: `✗ Session \`${sid}\` not found. Use \`/session list\` to see available sessions.`,
            timestamp: Date.now(),
          };
          setMessages((prev) => [...prev, msg]);
        } else {
          // Restore the session messages
          setMessages(entry.messages);
          currentSessionIdRef.current = entry.id;
          const time = new Date(entry.updatedAt).toLocaleString();
          const msg: ConversationMessage = {
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            role: 'assistant',
            content: `↻ Loaded session \`${entry.id}\` from ${time}\n\`${entry.name}\` — ${entry.messageCount} messages, model: ${entry.model}`,
            timestamp: Date.now(),
          };
          setMessages((prev) => [...prev, msg]);
        }
        return true;
      }

      if (subcommand === 'delete') {
        const sid = args.trim();
        if (!sid) {
          const msg: ConversationMessage = {
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            role: 'assistant',
            content: 'Usage: `/session delete <id>` — provide a session ID to delete.',
            timestamp: Date.now(),
          };
          setMessages((prev) => [...prev, msg]);
          return true;
        }

        const deleted = sessionManagerRef.current.delete(sid);
        const msg: ConversationMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          role: 'assistant',
          content: deleted
            ? `✓ Session \`${sid}\` deleted.`
            : `✗ Session \`${sid}\` not found.`,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, msg]);
        return true;
      }

      // Unknown /session subcommand
      const msg: ConversationMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        role: 'assistant',
        content: [
          'Usage: `/session <subcommand>`',
          '',
          '  `/session save [name]`     Save current conversation',
          '  `/session list`            List saved sessions',
          '  `/session load <id>`       Load a saved session',
          '  `/session delete <id>`     Delete a saved session',
          '',
          'Sessions are also auto-saved when you start a new prompt, use `/clear`, or exit.',
        ].join('\n'),
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, msg]);
      return true;
    }

    if (cmd === '/init' || cmd.startsWith('/init ')) {
      const args = cmd === '/init' ? '' : cmd.slice('/init '.length).trim();
      const createConfig = args === '--config';

      const result = createConfig
        ? runFullInit(projectDir, { createConfig: true })
        : runInit(projectDir);

      const lines: string[] = ['## /init Results', ''];
      if (result.created.length > 0) {
        lines.push('**Created:**');
        for (const f of result.created) lines.push(`  ✓ \`${f}\``);
        lines.push('');
      }
      if (result.skipped.length > 0) {
        lines.push('**Already exists (skipped):**');
        for (const f of result.skipped) lines.push(`  – \`${f}\``);
        lines.push('');
      }
      if (result.errors.length > 0) {
        lines.push('**Errors:**');
        for (const e of result.errors) lines.push(`  ✗ ${e}`);
        lines.push('');
      }
      if (result.created.length === 0 && result.errors.length === 0) {
        lines.push('All configuration files already exist. Nothing to create.');
      }

      if (createConfig) {
        lines.push('', 'Tip: Edit `.clonebuffrc` to set default model, temperature, and other preferences.');
      } else {
        lines.push('', 'Tip: Use `/init --config` to also create a `.clonebuffrc` config file.');
      }

      const msg: ConversationMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        role: 'assistant',
        content: lines.join('\n'),
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, msg]);
      return true;
    }

    if (cmd.startsWith('/checkpoint ')) {
      // Parse the subcommand: /checkpoint save [name], /checkpoint list, /checkpoint restore <id>
      const rest = cmd.slice('/checkpoint '.length).trim();
      const spaceIdx = rest.indexOf(' ');
      const subcommand = spaceIdx >= 0 ? rest.slice(0, spaceIdx) : rest;
      const args = spaceIdx >= 0 ? rest.slice(spaceIdx + 1).trim() : '';

      // Handle asynchronously via a fire-and-forget pattern
      handleCheckpointCommand(subcommand, args);
      return true;
    }

    return false;
  }, [exit, onClear, handleCheckpointCommand, handleCharacterCommand]);

  // ─── Cost estimation (rough, based on model family) ────────────────────

  /**
   * Estimate per-1M-token cost for a given model.
   * Uses approximate OpenRouter pricing. Returns { input, output } cost per 1M tokens.
   */
  function estimateTokenCost(model: string): { input: number; output: number } {
    const m = model.toLowerCase();
    if (m.includes('gpt-5')) return { input: 3.00, output: 6.00 };
    if (m.includes('gpt-4.1')) return { input: 2.00, output: 8.00 };
    if (m.includes('gpt-4o')) return { input: 2.50, output: 10.00 };
    if (m.includes('gpt-4')) return { input: 10.00, output: 30.00 };
    if (m.includes('gpt-3.5')) return { input: 0.50, output: 1.50 };
    if (m.includes('claude-3.5') || m.includes('claude-4')) return { input: 3.00, output: 15.00 };
    if (m.includes('claude-3')) return { input: 8.00, output: 24.00 };
    if (m.includes('gemini-2')) return { input: 0.10, output: 0.40 };
    if (m.includes('gemini-1.5')) return { input: 0.35, output: 1.50 };
    if (m.includes('deepseek')) return { input: 0.14, output: 0.28 };
    if (m.includes('llama-3')) return { input: 0.25, output: 1.00 };
    if (m.includes('mixtral')) return { input: 0.20, output: 0.60 };
    if (m.includes('command')) return { input: 0.15, output: 0.60 };
    // Default fallback
    return { input: 1.00, output: 3.00 };
  }

  // ─── Auto-save session (before starting new request, on clear, on exit) ──

  function autoSaveSession(name?: string): string | null {
    const msgs = messagesRef.current;
    if (msgs.length === 0) return null;
    const id = sessionManagerRef.current.save(
      msgs,
      config.model,
      { id: currentSessionIdRef.current ?? undefined, name },
    );
    currentSessionIdRef.current = id;
    return id;
  }

  // ─── Helper: summarize a tool result for display in completion status ────

  function summarizeToolResult(result: ToolResult): string {
    const content = result.content;
    if (content.startsWith('Error:')) return 'Failed';
    if (result.name === 'str_replace') return 'Edited file';
    if (result.name === 'write_file') return 'Created/updated file';
    if (result.name === 'read_files') return 'Read files';
    if (result.name === 'run_terminal_command') return 'Ran command';
    // Truncate long responses
    const firstLine = content.split('\n')[0] ?? '';
    return firstLine.length > 50 ? firstLine.slice(0, 50) + '...' : firstLine;
  }

  // ─── Shared: execute tool calls and return results + completion tracking ──

  async function executeTools(
    toolCalls: readonly import('../openrouter/types').ToolCall[],
  ): Promise<{ toolResults: ToolResult[]; completed: Array<{ name: string; success: boolean; summary: string }> }> {
    const settled = await Promise.allSettled(
      toolCalls.map(async (tc) => executeToolCall(tc, projectDir)),
    );

    const toolResults: ToolResult[] = [];
    const completed: Array<{ name: string; success: boolean; summary: string }> = [];

    for (const [i, s] of settled.entries()) {
      const tc = toolCalls[i];
      if (!tc) continue;

      if (s.status === 'fulfilled') {
        toolResults.push(s.value);
        completed.push({
          name: tc.function.name,
          success: !s.value.content.startsWith('Error:'),
          summary: summarizeToolResult(s.value),
        });
      } else {
        const errorMsg = s.reason instanceof Error ? s.reason.message : 'Unknown error';
        toolResults.push({
          toolCallId: tc.id,
          name: tc.function.name,
          content: `Error: ${errorMsg}`,
        });
        completed.push({
          name: tc.function.name,
          success: false,
          summary: `Failed: ${errorMsg}`,
        });
      }
    }

    return { toolResults, completed };
  }

  /** Generate preview diffs for a list of tool calls */
  async function generatePreviews(
    toolCalls: readonly import('../openrouter/types').ToolCall[],
  ): Promise<PendingToolChange[]> {
    const changes: PendingToolChange[] = [];
    for (const tc of toolCalls) {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
      } catch {
        args = {};
      }
      const preview = await previewToolChange(tc.function.name, args, projectDir);
      changes.push({
        toolCall: tc as import('../openrouter/types').ToolCall,
        diff: preview.diff ?? null,
        newContent: preview.newContent,
      });
    }
    return changes;
  }

  // ─── Resume after user confirmation ───────────────────────────────────────

  const resumeAfterConfirmation = useCallback(async (response: 'y' | 'n' | 'a') => {
    const pendingData = pendingContinuationRef.current;
    if (!pendingData) return;

    const { toolCalls, messages: currentMessages, turnCount } = pendingData;
    const MAX_TURNS = 10;
    const turn = turnCount + 1;

    if (turn > MAX_TURNS) {
      // Max turns reached
      setPendingChanges(null);
      pendingContinuationRef.current = null;
      setTurnInfo(null);
      setErrorMessage(
        'Reached maximum tool call turns (10). The model is using too many tool cycles. ' +
        'Try simplifying your request or breaking it into smaller steps.',
      );
      setPhase('ready');
      return;
    }

    // Handle 'a' (approve all) — disable confirmations for the rest of this session
    if (response === 'a') {
      confirmationsDisabledRef.current = true;
    }

    const approved = response === 'y' || response === 'a';

    // Clear the pending state immediately
    setPendingChanges(null);
    pendingContinuationRef.current = null;

    setPhase('processing');
    setToolStatus(null);
    setStreamingText('');
    setTurnInfo({ currentTurn: turn, maxTurns: MAX_TURNS });

    const client = new OpenRouterClient({
      apiKey: apiKey!,
      providerPreference: config.providerPreference,
    });

    try {
      // Execute or reject the tool calls
      const toolResults: ToolResult[] = [];
      const completed: Array<{ name: string; success: boolean; summary: string }> = [];

      if (approved) {
        // ── Execute all tool calls in parallel via shared helper ────────
        const result = await executeTools(toolCalls);
        toolResults.push(...result.toolResults);
        completed.push(...result.completed);
      } else {
        // ── User rejected — create rejection tool results ────────────
        for (const tc of toolCalls) {
          toolResults.push({
            toolCallId: tc.id,
            name: tc.function.name,
            content: 'User rejected this change. The file was not modified.',
          });
          completed.push({
            name: tc.function.name,
            success: true,
            summary: 'Skipped (rejected by user)',
          });
        }
      }

      // Add assistant message (already recorded) plus tool results
      const toolResultMessages: ConversationMessage[] = toolResults.map((tr) => ({
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        role: 'tool',
        content: tr.content,
        toolCallId: tr.toolCallId,
        name: tr.name,
        timestamp: Date.now(),
      }));

      setMessages((prev) => [...prev, ...toolResultMessages]);
      const updatedMessages = [...currentMessages, ...toolResultMessages];

      // Show completion briefly via toolStatus
      const userMsg = approved ? 'All tools complete' : 'Changes rejected';
      setToolStatus({
        currentTool: '',
        message: userMsg,
        completed,
      });

      // ── Continue the agent loop: make next API call ────────────────
      setStatusMessage(turn < MAX_TURNS ? `Turn ${turn} of ${MAX_TURNS}` : '');

      // Use a separate async continuation to avoid recursive call issues
      await continueAgentLoop(updatedMessages, turn, client);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      setErrorMessage(msg);
      setStatusMessage('');
      setTurnInfo(null);
      setToolStatus(null);
      setPhase('ready');
    }
  }, [apiKey, config, projectDir]);

  // ─── Continue agent loop (shared by handleSubmit and resumeAfterConfirmation) ─

  const continueAgentLoop = useCallback(async (
    currentMessages: ConversationMessage[],
    turn: number,
    client: OpenRouterClient,
  ) => {
    const MAX_TURNS = 10;

    if (turn > MAX_TURNS) {
      setTurnInfo(null);
      setErrorMessage(
        'Reached maximum tool call turns (10). The model is using too many tool cycles. ' +
        'Try simplifying your request or breaking it into smaller steps.',
      );
      setPhase('ready');
      return;
    }

    try {
      const result = await client.streamChat(
        {
          model: config.model,
          messages: toOpenRouterMessages(currentMessages),
          tools: getDefaultTools(),
          tool_choice: 'auto',
          temperature: config.temperature,
          max_tokens: config.maxTokens,
        },
        (token: string) => {
          setStreamingText((prev) => prev + token);
        },
      );

      // Track usage from this API call
      if (result.usage) {
        usageRef.current.promptTokens += result.usage.promptTokens;
        usageRef.current.completionTokens += result.usage.completionTokens;
        usageRef.current.totalTokens += result.usage.totalTokens;
      }
      usageRef.current.apiCalls++;
      usageRef.current.model = config.model;

      if (result.toolCalls.length > 0) {
        // More tool calls
        const assistantMsg: ConversationMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          role: 'assistant',
          content: result.content || '',
          toolCalls: result.toolCalls,
          timestamp: Date.now(),
        };

        setMessages((prev) => [...prev, assistantMsg]);
        setStreamingText('');

        if (config.confirmChanges && !confirmationsDisabledRef.current) {
          // Generate diffs and wait for confirmation
          const changes = await generatePreviews(result.toolCalls);
          pendingContinuationRef.current = {
            toolCalls: result.toolCalls,
            messages: [...currentMessages, assistantMsg],
            turnCount: turn,
          };
          setPendingChanges(changes);
          setToolStatus(null);
          setPhase('ready');
          return;
        }

        // Execute immediately
        const { toolResults, completed } = await executeTools(result.toolCalls);

        setToolStatus({
          currentTool: '',
          message: 'All tools complete',
          completed,
        });

        const toolResultMessages: ConversationMessage[] = toolResults.map((tr) => ({
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          role: 'tool',
          content: tr.content,
          toolCallId: tr.toolCallId,
          name: tr.name,
          timestamp: Date.now(),
        }));

        setMessages((prev) => [...prev, ...toolResultMessages]);
        const updatedMessages = [...currentMessages, assistantMsg, ...toolResultMessages];

        // Continue with the next turn
        await continueAgentLoop(updatedMessages, turn + 1, client);
      } else {
        // Text response — done
        const assistantMsg: ConversationMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          role: 'assistant',
          content: result.content,
          timestamp: Date.now(),
        };

        setStreamingText('');
        setMessages((prev) => [...prev, assistantMsg]);
        setToolStatus(null);
        setStatusMessage('');
        setTurnInfo(null);
        setPhase('ready');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      setErrorMessage(msg);
      setStatusMessage('');
      setTurnInfo(null);
      setToolStatus(null);
      setPhase('ready');
    }
  }, [apiKey, config, projectDir]);

  // ─── Submit handler ───────────────────────────────────────────────────────

  const onInputSubmit = useCallback((input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return;

    // If there are pending changes awaiting confirmation, handle y/n/a
    if (pendingChanges) {
      const response = trimmed.toLowerCase();
      if (response === 'y' || response === 'n' || response === 'a') {
        resumeAfterConfirmation(response);
      } else {
        // Invalid response — show a hint
        const hintMsg: ConversationMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          role: 'assistant',
          content: 'Please respond with **y** (yes), **n** (no), or **a** (always approve).',
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, hintMsg]);
      }
      return;
    }

    // Append to prompt history (avoid consecutive duplicates) and keep last 50
    setPromptHistory((prev) => {
      if (prev.length > 0 && prev[prev.length - 1] === trimmed) return prev;
      return [...prev, trimmed].slice(-50);
    });

    // Check for commands
    if (input.startsWith('/')) {
      handleCommand(input);
      return;
    }

    handleSubmit(input);
  }, [handleSubmit, handleCommand, pendingChanges, resumeAfterConfirmation]);

  // ─── Update input placeholder — show confirmation prompt when pending ────
  const inputPlaceholder = pendingChanges
    ? 'Approve changes? (y=yes, n=no, a=always)'
    : "Type your prompt... (Enter to send, Shift+Enter for newline)";

  const inputDisabled = phase === 'processing';

  // ─── Render: Setup Phase ──────────────────────────────────────────────────

  if (phase === 'loading') {
    return (
      <Box height="100%" justifyContent="center" alignItems="center">
        <Spinner message="Loading Clonebuff..." characterEmoji={character.emoji} />
      </Box>
    );
  }

  if (phase === 'setup') {
    return (
      <Box
        flexDirection="column"
        height="100%"
        paddingX={2}
        paddingY={1}
      >
        <Box flexDirection="column" flexGrow={1}>
          {setupMessages.map((line, i) => (
            <Text key={i} wrap="wrap">{line}</Text>
          ))}
        </Box>
        <Input
          onSubmit={(val) => {
            handleSetupSubmit(val);
          }}
          disabled={false}
          placeholder="Enter your response..."
        />
      </Box>
    );
  }

  // ─── Render: Main Chat ────────────────────────────────────────────────────

  return (
    <Box
      flexDirection="column"
      height="100%"
      paddingX={1}
    >
      {/* Header — character-themed */}
      <Box borderStyle="single" borderColor={character.color} paddingX={1} flexShrink={0}>
        <Text bold color={character.color}>{character.emoji} {character.name}</Text>
        <Text color="gray" dimColor> | </Text>
        <Text color="gray">/{'help'} for commands</Text>
      </Box>

      {/* Messages area */}
      <Messages
        messages={messages}
        streamingText={streamingText}
        isThinking={phase === 'processing' && !streamingText && !toolStatus}
        thinkingMessage={statusMessage || 'Thinking...'}
        toolStatus={toolStatus}
        character={character}
      />

      {/* Confirmation prompt — shows diffs when changes are pending */}
      {pendingChanges && (
        <Box flexShrink={0}>
          <ConfirmationPrompt pendingChanges={pendingChanges} />
        </Box>
      )}

      {/* Error message */}
      {errorMessage && (
        <Box
          borderStyle="round"
          borderColor="red"
          paddingX={1}
          marginY={1}
          flexShrink={0}
        >
          <Text color="red">✗ {errorMessage}</Text>
        </Box>
      )}

      {/* Spinner during initial processing (no streaming and no tools yet) */}
      {phase === 'processing' && !streamingText && !toolStatus && (
        <Box marginLeft={2} marginBottom={1} flexShrink={0}>
          <Spinner message={statusMessage || 'Processing...'} characterEmoji={character.emoji} />
        </Box>
      )}

      {/* Status bar */}
      <StatusBar
        model={config.model}
        checkpointMode={checkpointMode}
        messageCount={messages.filter((m) => m.role !== 'system').length}
        contextStats={contextManagerRef.current.getStats()}
        turnInfo={turnInfo}
        character={character}
      />

      {/* Input */}
      <Input
        onSubmit={onInputSubmit}
        disabled={inputDisabled}
        placeholder={inputPlaceholder}
        promptHistory={promptHistory}
      />
    </Box>
  );
}
