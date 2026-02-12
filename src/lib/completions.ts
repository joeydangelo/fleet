/** Shell completion script generators for paw CLI. */

const SUBCOMMANDS = [
  'setup',
  'up',
  'prime',
  'status',
  'done',
  'merge',
  'down',
  'broadcast',
  'ask',
  'reply',
  'check',
  'completions',
];

/** Generate a bash completion script for paw. */
export function generateBashCompletion(): string {
  return `# paw bash completion
# Add to ~/.bashrc: eval "$(paw completions bash)"

_paw_completions() {
  local cur prev cmds
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  cmds="${SUBCOMMANDS.join(' ')}"

  # Complete --pick with task names from paw.yaml
  if [[ "\$prev" == "--pick" ]]; then
    local tasks=""
    if [[ -f "paw.yaml" ]]; then
      tasks=$(grep -E '^  [a-zA-Z_][a-zA-Z0-9_-]*:' paw.yaml | sed 's/^  //;s/://')
    elif [[ -f "paw.yml" ]]; then
      tasks=$(grep -E '^  [a-zA-Z_][a-zA-Z0-9_-]*:' paw.yml | sed 's/^  //;s/://')
    fi
    COMPREPLY=($(compgen -W "\$tasks" -- "\$cur"))
    return
  fi

  # Complete flags for merge
  if [[ "\${COMP_WORDS[1]}" == "merge" && "\$cur" == -* ]]; then
    COMPREPLY=($(compgen -W "--pick --config" -- "\$cur"))
    return
  fi

  # Complete flags for up
  if [[ "\${COMP_WORDS[1]}" == "up" && "\$cur" == -* ]]; then
    COMPREPLY=($(compgen -W "--config --dry-run" -- "\$cur"))
    return
  fi

  # Complete flags for down
  if [[ "\${COMP_WORDS[1]}" == "down" && "\$cur" == -* ]]; then
    COMPREPLY=($(compgen -W "--config --dry-run --keep-branches" -- "\$cur"))
    return
  fi

  # Complete subcommands
  if [[ \$COMP_CWORD -eq 1 ]]; then
    COMPREPLY=($(compgen -W "\$cmds" -- "\$cur"))
    return
  fi
}

complete -F _paw_completions paw
`;
}

/** Generate a zsh completion script for paw. */
export function generateZshCompletion(): string {
  return `#compdef paw
# paw zsh completion
# Add to ~/.zshrc: eval "$(paw completions zsh)"

_paw() {
  local -a subcommands
  subcommands=(
${SUBCOMMANDS.map((cmd) => `    '${cmd}:${descriptionFor(cmd)}'`).join('\n')}
  )

  _paw_task_names() {
    local tasks=()
    local config_file=""
    if [[ -f "paw.yaml" ]]; then
      config_file="paw.yaml"
    elif [[ -f "paw.yml" ]]; then
      config_file="paw.yml"
    fi
    if [[ -n "\$config_file" ]]; then
      tasks=(\${(f)"$(grep -E '^  [a-zA-Z_][a-zA-Z0-9_-]*:' "\$config_file" | sed 's/^  //;s/://')"})
    fi
    compadd -a tasks
  }

  if (( CURRENT == 2 )); then
    _describe 'subcommand' subcommands
  else
    case "\$words[2]" in
      merge)
        _arguments \\
          '--pick[Merge specific task]:task:_paw_task_names' \\
          '--config[Config path]:file:_files'
        ;;
      up)
        _arguments \\
          '--config[Config path]:file:_files' \\
          '--dry-run[Preview changes]'
        ;;
      down)
        _arguments \\
          '--config[Config path]:file:_files' \\
          '--dry-run[Preview removals]' \\
          '--keep-branches[Keep branches]'
        ;;
      status)
        _arguments '--config[Config path]:file:_files'
        ;;
    esac
  fi
}

_paw "$@"
`;
}

/** Generate a fish completion script for paw. */
export function generateFishCompletion(): string {
  const lines = [
    '# paw fish completion',
    '# Add to fish: paw completions fish | source',
    '',
    '# Disable file completions by default',
    'complete -c paw -f',
    '',
    '# Subcommands',
  ];

  for (const cmd of SUBCOMMANDS) {
    lines.push(
      `complete -c paw -n '__fish_use_subcommand' -a '${cmd}' -d '${descriptionFor(cmd)}'`,
    );
  }

  lines.push('');
  lines.push('# merge flags');
  lines.push(
    "complete -c paw -n '__fish_seen_subcommand_from merge' -l pick -d 'Merge specific task' -r -a '(_paw_task_names)'",
  );
  lines.push(
    "complete -c paw -n '__fish_seen_subcommand_from merge' -l config -d 'Config path' -r -F",
  );
  lines.push('');
  lines.push('# up flags');
  lines.push(
    "complete -c paw -n '__fish_seen_subcommand_from up' -l config -d 'Config path' -r -F",
  );
  lines.push("complete -c paw -n '__fish_seen_subcommand_from up' -l dry-run -d 'Preview changes'");
  lines.push('');
  lines.push('# down flags');
  lines.push(
    "complete -c paw -n '__fish_seen_subcommand_from down' -l config -d 'Config path' -r -F",
  );
  lines.push(
    "complete -c paw -n '__fish_seen_subcommand_from down' -l dry-run -d 'Preview removals'",
  );
  lines.push(
    "complete -c paw -n '__fish_seen_subcommand_from down' -l keep-branches -d 'Keep branches'",
  );
  lines.push('');
  lines.push('# Dynamic task name completion from paw.yaml');
  lines.push('function _paw_task_names');
  lines.push('  if test -f paw.yaml');
  lines.push("    grep -E '^  [a-zA-Z_][a-zA-Z0-9_-]*:' paw.yaml | sed 's/^  //;s/://'");
  lines.push('  else if test -f paw.yml');
  lines.push("    grep -E '^  [a-zA-Z_][a-zA-Z0-9_-]*:' paw.yml | sed 's/^  //;s/://'");
  lines.push('  end');
  lines.push('end');
  lines.push('');

  return lines.join('\n');
}

function descriptionFor(cmd: string): string {
  const descriptions: Record<string, string> = {
    setup: 'Initialize paw in a repo',
    up: 'Spin up parallel session',
    prime: 'Orient agent and claim task',
    status: 'Show session progress',
    done: 'Mark task as completed',
    merge: 'Merge task branches into target',
    down: 'Tear down session',
    broadcast: 'Broadcast message to all agents',
    ask: 'Send directed message to agent',
    reply: 'Reply to last directed message',
    check: 'Read new messages and broadcasts',
    completions: 'Generate shell completions',
  };
  return descriptions[cmd] ?? cmd;
}
