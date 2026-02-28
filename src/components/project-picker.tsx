import React, { useState, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { parsePathInput, scanDirectories } from '../lib/dir-scanner.js';
import { SIDEBAR_WIDTH } from '../lib/constants.js';

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
  const entries = scanDirectories(parentDir, prefix).filter((e) => e.isGitRepo);

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
        onSelect(target.fullPath);
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
