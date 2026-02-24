import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { parsePathInput, scanDirectories } from '../lib/dir-scanner.js';
import { getAvailableAgents } from '../lib/agent-detection.js';
import type { AgentName } from '../lib/tmux.js';
import { SIDEBAR_WIDTH } from '../lib/tui-helpers.js';

const LINE_WIDTH = SIDEBAR_WIDTH - 4; // box border + padding

interface ProjectPickerProps {
  defaultPath: string;
  onSelect: (projectRoot: string) => void;
  onCancel: () => void;
}

export function ProjectPicker({ defaultPath, onSelect, onCancel }: ProjectPickerProps) {
  const [inputValue, setInputValue] = useState(defaultPath);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const prevInputRef = useRef(inputValue);

  const { parentDir, prefix } = parsePathInput(inputValue);
  const entries = scanDirectories(parentDir, prefix);

  // Reset selection when input changes
  if (prevInputRef.current !== inputValue) {
    prevInputRef.current = inputValue;
    if (selectedIndex !== -1) setSelectedIndex(-1);
  }

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.downArrow || input === 'j') {
      setSelectedIndex((i) => Math.min(entries.length - 1, i + 1));
      return;
    }
    if (key.upArrow || input === 'k') {
      setSelectedIndex((i) => Math.max(-1, i - 1));
      return;
    }

    if (key.tab) {
      const target = selectedIndex >= 0 ? entries[selectedIndex] : entries[0];
      if (target) {
        setInputValue(target.fullPath + '/');
        setSelectedIndex(-1);
      }
      return;
    }

    if (key.return) {
      const target = selectedIndex >= 0 ? entries[selectedIndex] : null;
      if (target) {
        if (target.isGitRepo) {
          onSelect(target.fullPath);
        } else {
          // Navigate into non-git directory
          setInputValue(target.fullPath + '/');
          setSelectedIndex(-1);
        }
      }
      return;
    }

    if (key.backspace || key.delete) {
      setInputValue((v) => v.slice(0, -1));
      return;
    }

    // Regular character input
    if (input && !key.ctrl && !key.meta) {
      setInputValue((v) => v + input);
    }
  });

  const maxVisible = 8;
  const visibleEntries = entries.slice(0, maxVisible);

  return (
    <Box flexDirection="column" width={SIDEBAR_WIDTH}>
      <Box marginBottom={1}>
        <Text bold>Select Project</Text>
      </Box>

      <Box>
        <Text color="cyan">&gt; </Text>
        <Text>{inputValue || '(type a path)'}</Text>
        <Text color="cyan">{'█'}</Text>
      </Box>

      <Box marginTop={1} marginBottom={0}>
        <Text dimColor>
          {entries.length} match{entries.length !== 1 ? 'es' : ''}
        </Text>
      </Box>

      {visibleEntries.map((entry, i) => (
        <Box key={entry.fullPath}>
          <Text color={i === selectedIndex ? 'cyan' : undefined} bold={i === selectedIndex}>
            {i === selectedIndex ? '  ❯ ' : '    '}
            {entry.name.substring(0, LINE_WIDTH - 8)}
            {'/'}
          </Text>
          {entry.isGitRepo && <Text color="green">{' [git]'}</Text>}
        </Box>
      ))}
      {entries.length > maxVisible && <Text dimColor> ... {entries.length - maxVisible} more</Text>}

      <Box marginTop={1}>
        <Text dimColor>↓ browse Tab complete Enter select ESC cancel</Text>
      </Box>
    </Box>
  );
}

interface AgentPickerProps {
  onSelect: (agent: AgentName) => void;
  onCancel: () => void;
}

export function AgentPicker({ onSelect, onCancel }: AgentPickerProps) {
  const [agents, setAgents] = useState<AgentName[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [autoSelected, setAutoSelected] = useState(false);

  useEffect(() => {
    const available = getAvailableAgents();
    setAgents(available);
    if (available.length === 1) {
      setAutoSelected(true);
      onSelect(available[0]!);
    }
  }, []);

  useInput((_input, key) => {
    if (autoSelected) return;

    if (key.escape) {
      onCancel();
      return;
    }

    if (key.downArrow || _input === 'j') {
      setSelectedIndex((i) => Math.min(agents.length - 1, i + 1));
      return;
    }
    if (key.upArrow || _input === 'k') {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }

    if (key.return) {
      const agent = agents[selectedIndex];
      if (agent) onSelect(agent);
    }
  });

  if (autoSelected || agents.length === 0) {
    return (
      <Box flexDirection="column" width={SIDEBAR_WIDTH}>
        <Text dimColor>{agents.length === 0 ? 'No agents found' : 'Auto-selecting agent...'}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={SIDEBAR_WIDTH}>
      <Box marginBottom={1}>
        <Text bold>Select Agent</Text>
      </Box>

      {agents.map((agent, i) => (
        <Box key={agent}>
          <Text color={i === selectedIndex ? 'cyan' : undefined} bold={i === selectedIndex}>
            {i === selectedIndex ? '  ❯ ' : '    '}
            {agent}
          </Text>
        </Box>
      ))}

      <Box marginTop={1}>
        <Text dimColor>↑/↓ navigate Enter select ESC cancel</Text>
      </Box>
    </Box>
  );
}
