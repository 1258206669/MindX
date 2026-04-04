/**
 * Terminal UI — Ink (React) based REPL
 */

import React, { useState, useCallback } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { Orchestrator } from '../core/orchestrator.js';

interface Props {
  orchestrator: Orchestrator;
}

interface HistoryItem {
  type: 'input' | 'output' | 'error' | 'info';
  text: string;
}

export function App({ orchestrator }: Props) {
  const { exit } = useApp();
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<HistoryItem[]>([
    { type: 'info', text: '🤖 multi-agent-cli ready. Type /help for commands, /agents to list agents.' },
  ]);
  const [loading, setLoading] = useState(false);

  const addHistory = useCallback((item: HistoryItem) => {
    setHistory((prev: HistoryItem[]) => [...prev.slice(-50), item]);
  }, []);

  const handleSubmit = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setInput('');

    // 内置命令
    if (trimmed.startsWith('/')) {
      handleCommand(trimmed);
      return;
    }

    addHistory({ type: 'input', text: `> ${trimmed}` });
    setLoading(true);

    const result = await orchestrator.handle(trimmed);
    setLoading(false);

    if (result.success) {
      addHistory({ type: 'output', text: result.output || '(done)' });
    } else {
      addHistory({ type: 'error', text: result.error ?? 'Unknown error' });
    }
  }, [orchestrator, addHistory]);

  const handleCommand = (cmd: string) => {
    const [name, ...args] = cmd.slice(1).split(' ');

    switch (name) {
      case 'help':
        addHistory({ type: 'info', text: [
          'Commands:',
          '  /agents        — List registered agents',
          '  /session       — Show session ID',
          '  /new           — Start new session',
          '  /memory <q>    — Search memory',
          '  /quit          — Exit',
          '',
          'Usage:',
          '  @agent:name <input>  — Direct to specific agent',
          '  <natural language>   — Auto-route to best agent',
        ].join('\n') });
        break;

      case 'agents':
        const agents = orchestrator.listAgents();
        const list = agents.map(a => `  ${a.name} (${a.backend}) — ${a.description}`).join('\n');
        addHistory({ type: 'info', text: `Registered agents:\n${list}` });
        break;

      case 'session':
        addHistory({ type: 'info', text: `Session: ${orchestrator.getSessionId()}` });
        break;

      case 'new':
        orchestrator.newSession();
        addHistory({ type: 'info', text: `New session: ${orchestrator.getSessionId()}` });
        break;

      case 'memory':
        const query = args.join(' ');
        const results = orchestrator.getMemory().search(query);
        if (results.length === 0) {
          addHistory({ type: 'info', text: 'No memories found.' });
        } else {
          const mem = results.map(m => `  [${m.agentName}] ${m.content.slice(0, 80)}`).join('\n');
          addHistory({ type: 'info', text: `Memory results:\n${mem}` });
        }
        break;

      case 'quit':
      case 'exit':
        orchestrator.destroy();
        exit();
        break;

      default:
        addHistory({ type: 'error', text: `Unknown command: /${name}` });
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      {/* History */}
      {history.map((item: HistoryItem, i: number) => (
        <Text
          key={i}
          color={
            item.type === 'input' ? 'cyan' :
            item.type === 'output' ? 'green' :
            item.type === 'error' ? 'red' :
            'gray'
          }
        >
          {item.text}
        </Text>
      ))}

      {/* Loading */}
      {loading && <Text color="yellow">⏳ thinking...</Text>}

      {/* Input */}
      <Box>
        <Text color="magenta">❯ </Text>
        <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} />
      </Box>
    </Box>
  );
}
