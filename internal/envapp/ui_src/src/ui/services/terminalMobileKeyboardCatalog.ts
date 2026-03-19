export type TerminalCommandCatalogPathPreference = 'files' | 'directories';

export type TerminalCommandCatalogArgumentEntry = {
  name: string;
  detail: string;
  kind?: 'subcommand' | 'option';
  featured?: boolean;
  pathContext?: boolean;
  pathPreference?: TerminalCommandCatalogPathPreference;
  takesValue?: boolean;
  valueHint?: string;
  subcommands?: readonly TerminalCommandCatalogArgumentEntry[];
};

export type TerminalCommandCatalogEntry = {
  command: string;
  detail: string;
  featured?: boolean;
  pathContext?: boolean;
  pathPreference?: TerminalCommandCatalogPathPreference;
  subcommands?: readonly TerminalCommandCatalogArgumentEntry[];
};

const FILE_SYSTEM_COMMANDS: readonly TerminalCommandCatalogEntry[] = [
  {
    command: 'cd',
    detail: 'Change directory',
    featured: true,
    pathContext: true,
    pathPreference: 'directories',
  },
  {
    command: 'ls',
    detail: 'List directory contents',
    featured: true,
    pathContext: true,
    pathPreference: 'directories',
    subcommands: [
      { name: '-la', detail: 'Show all files with details', kind: 'option', featured: true },
      { name: '-lh', detail: 'Show human-readable file sizes', kind: 'option', featured: true },
      { name: '-R', detail: 'List subdirectories recursively', kind: 'option' },
    ],
  },
  { command: 'pwd', detail: 'Print working directory', featured: true },
  { command: 'cat', detail: 'Print file contents', pathContext: true, pathPreference: 'files' },
  {
    command: 'mkdir',
    detail: 'Create directories',
    pathContext: true,
    pathPreference: 'directories',
    subcommands: [
      { name: '-p', detail: 'Create parent directories as needed', kind: 'option', featured: true },
    ],
  },
  {
    command: 'touch',
    detail: 'Create files or update timestamps',
    pathContext: true,
    pathPreference: 'files',
  },
  {
    command: 'cp',
    detail: 'Copy files or directories',
    pathContext: true,
    subcommands: [
      { name: '-r', detail: 'Copy directories recursively', kind: 'option', featured: true },
      { name: '-i', detail: 'Prompt before overwrite', kind: 'option' },
    ],
  },
  {
    command: 'mv',
    detail: 'Move or rename files or directories',
    pathContext: true,
    subcommands: [
      { name: '-i', detail: 'Prompt before overwrite', kind: 'option', featured: true },
    ],
  },
  {
    command: 'rm',
    detail: 'Remove files or directories',
    pathContext: true,
    subcommands: [
      { name: '-f', detail: 'Force removal without prompts', kind: 'option', featured: true },
      { name: '-r', detail: 'Remove directories recursively', kind: 'option', featured: true },
      { name: '-rf', detail: 'Force recursive removal', kind: 'option' },
    ],
  },
  {
    command: 'rmdir',
    detail: 'Remove empty directories',
    pathContext: true,
    pathPreference: 'directories',
  },
  {
    command: 'less',
    detail: 'Open a pager for file contents',
    pathContext: true,
    pathPreference: 'files',
  },
  {
    command: 'more',
    detail: 'Page through file contents',
    pathContext: true,
    pathPreference: 'files',
  },
  {
    command: 'open',
    detail: 'Open a file or directory with the default app',
    pathContext: true,
    pathPreference: 'files',
  },
  { command: 'head', detail: 'Show the first lines of a file' },
  {
    command: 'tail',
    detail: 'Show the last lines of a file',
    pathContext: true,
    pathPreference: 'files',
  },
  {
    command: 'tree',
    detail: 'Show a directory tree',
    pathContext: true,
    pathPreference: 'directories',
  },
  { command: 'stat', detail: 'Inspect file metadata' },
  { command: 'file', detail: 'Detect file type' },
  {
    command: 'chmod',
    detail: 'Change file permissions',
    subcommands: [
      { name: '-R', detail: 'Change permissions recursively', kind: 'option' },
    ],
  },
  {
    command: 'ln',
    detail: 'Create links between files',
    subcommands: [
      { name: '-s', detail: 'Create a symbolic link', kind: 'option', featured: true },
    ],
  },
];

const SEARCH_AND_TEXT_COMMANDS: readonly TerminalCommandCatalogEntry[] = [
  {
    command: 'grep',
    detail: 'Search text by pattern',
    featured: true,
    subcommands: [
      { name: '-n', detail: 'Show line numbers', kind: 'option', featured: true },
      { name: '-i', detail: 'Ignore letter case', kind: 'option', featured: true },
      { name: '-r', detail: 'Search recursively', kind: 'option' },
    ],
  },
  {
    command: 'find',
    detail: 'Find files and directories',
    featured: true,
    pathContext: true,
    pathPreference: 'directories',
    subcommands: [
      {
        name: '-name',
        detail: 'Match by file name',
        kind: 'option',
        featured: true,
        takesValue: true,
        valueHint: '<pattern>',
      },
      {
        name: '-type',
        detail: 'Filter by entry type',
        kind: 'option',
        featured: true,
        takesValue: true,
        valueHint: '<type>',
      },
      {
        name: '-maxdepth',
        detail: 'Limit search depth',
        kind: 'option',
        takesValue: true,
        valueHint: '<depth>',
      },
    ],
  },
  {
    command: 'rg',
    detail: 'Search recursively with ripgrep',
    featured: true,
    subcommands: [
      { name: '-n', detail: 'Show line numbers', kind: 'option', featured: true },
      { name: '--hidden', detail: 'Include hidden files', kind: 'option', featured: true },
      { name: '--glob', detail: 'Filter files by glob pattern', kind: 'option' },
    ],
  },
  { command: 'sed', detail: 'Edit text streams with patterns' },
  { command: 'awk', detail: 'Process structured text streams' },
  { command: 'sort', detail: 'Sort input lines' },
  { command: 'uniq', detail: 'Filter repeated lines' },
  { command: 'cut', detail: 'Select sections from each line' },
  { command: 'wc', detail: 'Count lines, words, and bytes' },
  { command: 'xargs', detail: 'Build command lines from stdin' },
];

const SYSTEM_COMMANDS: readonly TerminalCommandCatalogEntry[] = [
  { command: 'clear', detail: 'Clear terminal output', featured: true },
  { command: 'history', detail: 'Show shell command history' },
  { command: 'echo', detail: 'Print a line of text' },
  { command: 'env', detail: 'Show the current environment' },
  { command: 'printenv', detail: 'Print environment variables' },
  {
    command: 'uname',
    detail: 'Show system information',
    subcommands: [
      { name: '-a', detail: 'Show all available system details', kind: 'option', featured: true },
      { name: '-s', detail: 'Show kernel name', kind: 'option' },
      { name: '-m', detail: 'Show machine hardware name', kind: 'option' },
      { name: '-r', detail: 'Show kernel release', kind: 'option' },
    ],
  },
  { command: 'hostname', detail: 'Show or set the system hostname' },
  { command: 'whoami', detail: 'Print the current user name' },
  { command: 'date', detail: 'Print or set the system date and time' },
  { command: 'which', detail: 'Locate a command in PATH' },
  { command: 'whereis', detail: 'Locate a command, source, and man page' },
  { command: 'man', detail: 'Read command manuals' },
  { command: 'ps', detail: 'Inspect running processes' },
  { command: 'top', detail: 'Monitor running processes interactively' },
  { command: 'htop', detail: 'Monitor running processes with an enhanced UI' },
  { command: 'kill', detail: 'Send a signal to a process' },
  { command: 'killall', detail: 'Send a signal to processes by name' },
  { command: 'jobs', detail: 'List shell background jobs' },
  { command: 'fg', detail: 'Bring a background job to the foreground' },
  { command: 'bg', detail: 'Resume a job in the background' },
  { command: 'sleep', detail: 'Pause for a duration' },
  { command: 'watch', detail: 'Run a command repeatedly' },
  {
    command: 'systemctl',
    detail: 'Control systemd services',
    subcommands: [
      { name: 'status', detail: 'Show current service status', featured: true },
      { name: 'start', detail: 'Start a service', featured: true },
      { name: 'stop', detail: 'Stop a service', featured: true },
      { name: 'restart', detail: 'Restart a service' },
      { name: 'enable', detail: 'Enable a service at boot' },
      { name: 'disable', detail: 'Disable a service at boot' },
    ],
  },
  {
    command: 'journalctl',
    detail: 'Inspect systemd journals',
    subcommands: [
      { name: '-u', detail: 'Filter logs by unit name', kind: 'option', featured: true },
      { name: '-f', detail: 'Follow new log entries', kind: 'option', featured: true },
      {
        name: '-n',
        detail: 'Show the most recent entries',
        kind: 'option',
        takesValue: true,
        valueHint: '<count>',
      },
    ],
  },
];

const EDITOR_COMMANDS: readonly TerminalCommandCatalogEntry[] = [
  {
    command: 'nano',
    detail: 'Open a terminal text editor',
    pathContext: true,
    pathPreference: 'files',
  },
  {
    command: 'vi',
    detail: 'Open the Vi text editor',
    pathContext: true,
    pathPreference: 'files',
  },
  {
    command: 'vim',
    detail: 'Open the Vim text editor',
    pathContext: true,
    pathPreference: 'files',
    subcommands: [
      { name: '-R', detail: 'Open files in read-only mode', kind: 'option', featured: true },
      {
        name: '-O',
        detail: 'Open files in vertical splits',
        kind: 'option',
        featured: true,
        pathContext: true,
        pathPreference: 'files',
        takesValue: true,
        valueHint: '<file>',
      },
      {
        name: '-o',
        detail: 'Open files in horizontal splits',
        kind: 'option',
        pathContext: true,
        pathPreference: 'files',
        takesValue: true,
        valueHint: '<file>',
      },
    ],
  },
  {
    command: 'vimdiff',
    detail: 'Open Vim in diff mode',
    pathContext: true,
    pathPreference: 'files',
  },
];

const ARCHIVE_AND_NETWORK_COMMANDS: readonly TerminalCommandCatalogEntry[] = [
  {
    command: 'tar',
    detail: 'Create or extract archive files',
    subcommands: [
      { name: '-czf', detail: 'Create a gzip archive', kind: 'option', featured: true },
      { name: '-xzf', detail: 'Extract a gzip archive', kind: 'option', featured: true },
      { name: '-tf', detail: 'List archive contents', kind: 'option' },
    ],
  },
  { command: 'zip', detail: 'Create a zip archive' },
  { command: 'unzip', detail: 'Extract a zip archive' },
  {
    command: 'curl',
    detail: 'Transfer data from or to a server',
    subcommands: [
      { name: '-L', detail: 'Follow HTTP redirects', kind: 'option', featured: true },
      { name: '-I', detail: 'Fetch response headers only', kind: 'option' },
      { name: '-O', detail: 'Write output to a file named by the remote source', kind: 'option' },
      {
        name: '-H',
        detail: 'Send a custom request header',
        kind: 'option',
        takesValue: true,
        valueHint: '<header>',
      },
    ],
  },
  { command: 'wget', detail: 'Download files from the web' },
  { command: 'ping', detail: 'Check network reachability' },
  {
    command: 'ssh',
    detail: 'Open a secure shell session',
    subcommands: [
      {
        name: '-i',
        detail: 'Use a specific private key file',
        kind: 'option',
        featured: true,
        pathContext: true,
        pathPreference: 'files',
        takesValue: true,
        valueHint: '<identity_file>',
      },
      {
        name: '-p',
        detail: 'Connect to a non-default port',
        kind: 'option',
        takesValue: true,
        valueHint: '<port>',
      },
    ],
  },
  { command: 'scp', detail: 'Copy files over SSH' },
  { command: 'rsync', detail: 'Synchronize files between locations' },
  {
    command: 'tmux',
    detail: 'Manage terminal multiplexing sessions',
    subcommands: [
      { name: 'new-session', detail: 'Create a new tmux session', featured: true },
      { name: 'attach', detail: 'Attach to an existing tmux session', featured: true },
      { name: 'list-sessions', detail: 'List tmux sessions' },
      { name: 'kill-session', detail: 'Terminate a tmux session' },
    ],
  },
  {
    command: 'screen',
    detail: 'Manage GNU Screen sessions',
    subcommands: [
      { name: '-ls', detail: 'List existing screen sessions', kind: 'option', featured: true },
      {
        name: '-r',
        detail: 'Resume a detached screen session',
        kind: 'option',
        featured: true,
        takesValue: true,
        valueHint: '<session>',
      },
    ],
  },
];

const RUNTIME_AND_BUILD_COMMANDS: readonly TerminalCommandCatalogEntry[] = [
  {
    command: 'git',
    detail: 'Distributed version control',
    featured: true,
    subcommands: [
      { name: 'status', detail: 'Show tracked changes', featured: true },
      {
        name: 'diff',
        detail: 'Inspect current diff',
        featured: true,
        pathContext: true,
        pathPreference: 'files',
        subcommands: [
          { name: '--stat', detail: 'Show a summary of changed files', kind: 'option', featured: true },
          { name: '--staged', detail: 'Compare staged changes', kind: 'option', featured: true },
          { name: '--cached', detail: 'Compare staged changes', kind: 'option' },
          { name: '--name-only', detail: 'Show only changed file names', kind: 'option' },
        ],
      },
      {
        name: 'add',
        detail: 'Stage file changes',
        featured: true,
        pathContext: true,
        pathPreference: 'files',
        subcommands: [
          { name: '-A', detail: 'Stage all changes', kind: 'option', featured: true },
          { name: '-p', detail: 'Select hunks interactively', kind: 'option', featured: true },
          { name: '--all', detail: 'Stage all changes', kind: 'option' },
        ],
      },
      {
        name: 'restore',
        detail: 'Restore file contents',
        pathContext: true,
        pathPreference: 'files',
        subcommands: [
          { name: '--staged', detail: 'Restore the staged version', kind: 'option', featured: true },
          {
            name: '--source',
            detail: 'Restore from a specific tree-ish',
            kind: 'option',
            takesValue: true,
            valueHint: '<tree-ish>',
          },
        ],
      },
      {
        name: 'checkout',
        detail: 'Switch branches or paths',
        pathContext: true,
        pathPreference: 'files',
        subcommands: [
          {
            name: '-b',
            detail: 'Create and switch to a new branch',
            kind: 'option',
            featured: true,
            takesValue: true,
            valueHint: '<branch>',
          },
          { name: '--', detail: 'Treat following arguments as paths', kind: 'option' },
        ],
      },
      {
        name: 'switch',
        detail: 'Switch branches',
        subcommands: [
          {
            name: '-c',
            detail: 'Create and switch to a new branch',
            kind: 'option',
            featured: true,
            takesValue: true,
            valueHint: '<branch>',
          },
        ],
      },
      { name: 'pull', detail: 'Fetch and merge remote changes' },
      { name: 'push', detail: 'Push local commits' },
      { name: 'fetch', detail: 'Download remote refs and objects' },
      {
        name: 'commit',
        detail: 'Create a commit',
        subcommands: [
          {
            name: '-m',
            detail: 'Use the given commit message',
            kind: 'option',
            featured: true,
            takesValue: true,
            valueHint: '<message>',
          },
          { name: '--amend', detail: 'Amend the previous commit', kind: 'option', featured: true },
        ],
      },
      {
        name: 'branch',
        detail: 'Manage branches',
        subcommands: [
          {
            name: '-d',
            detail: 'Delete a branch',
            kind: 'option',
            takesValue: true,
            valueHint: '<branch>',
          },
          {
            name: '-D',
            detail: 'Force-delete a branch',
            kind: 'option',
            takesValue: true,
            valueHint: '<branch>',
          },
        ],
      },
      {
        name: 'merge',
        detail: 'Join histories together',
        subcommands: [
          { name: '--no-ff', detail: 'Create a merge commit even when fast-forward is possible', kind: 'option', featured: true },
        ],
      },
      {
        name: 'rebase',
        detail: 'Reapply commits on top of another base',
        subcommands: [
          { name: '--continue', detail: 'Continue the current rebase', kind: 'option', featured: true },
          { name: '--abort', detail: 'Abort the current rebase', kind: 'option', featured: true },
        ],
      },
      {
        name: 'log',
        detail: 'Show commit history',
        subcommands: [
          { name: '--oneline', detail: 'Condense each commit to one line', kind: 'option', featured: true },
          { name: '--stat', detail: 'Show file change statistics', kind: 'option', featured: true },
          { name: '-p', detail: 'Show patch text for each commit', kind: 'option' },
        ],
      },
      { name: 'stash', detail: 'Save work temporarily' },
      {
        name: 'reset',
        detail: 'Reset current HEAD to a state',
        subcommands: [
          { name: '--soft', detail: 'Keep changes staged', kind: 'option' },
          { name: '--mixed', detail: 'Keep changes in the working tree', kind: 'option' },
          { name: '--hard', detail: 'Discard changes from index and working tree', kind: 'option', featured: true },
        ],
      },
      {
        name: 'clone',
        detail: 'Clone a repository into a new directory',
        subcommands: [
          {
            name: '--depth',
            detail: 'Limit clone history depth',
            kind: 'option',
            takesValue: true,
            valueHint: '<depth>',
          },
          {
            name: '--branch',
            detail: 'Checkout a specific branch after clone',
            kind: 'option',
            takesValue: true,
            valueHint: '<branch>',
          },
        ],
      },
      { name: 'grep', detail: 'Search tracked content' },
    ],
  },
  { command: 'make', detail: 'Run targets from a Makefile', featured: true },
  {
    command: 'pnpm',
    detail: 'Run project packages and scripts',
    featured: true,
    subcommands: [
      { name: 'install', detail: 'Install dependencies', featured: true },
      { name: 'add', detail: 'Add a dependency', featured: true },
      { name: 'remove', detail: 'Remove a dependency' },
      { name: 'dev', detail: 'Run the default dev script', featured: true },
      { name: 'build', detail: 'Run the default build script', featured: true },
      { name: 'test', detail: 'Run the default test script', featured: true },
      { name: 'lint', detail: 'Run the default lint script', featured: true },
      { name: 'exec', detail: 'Execute a command in the package environment' },
      { name: 'dlx', detail: 'Run a package without installing it permanently' },
      { name: 'run', detail: 'Run a package script' },
    ],
  },
  {
    command: 'npm',
    detail: 'Run project packages and scripts',
    featured: true,
    subcommands: [
      { name: 'install', detail: 'Install dependencies', featured: true },
      { name: 'ci', detail: 'Install dependencies from lockfile' },
      { name: 'run', detail: 'Run a package script', featured: true },
      { name: 'test', detail: 'Run the test script', featured: true },
      { name: 'build', detail: 'Run the build script', featured: true },
      { name: 'exec', detail: 'Run a package binary' },
    ],
  },
  {
    command: 'yarn',
    detail: 'Run project packages and scripts',
    subcommands: [
      { name: 'install', detail: 'Install dependencies', featured: true },
      { name: 'add', detail: 'Add a dependency' },
      { name: 'remove', detail: 'Remove a dependency' },
      { name: 'dev', detail: 'Run the default dev script', featured: true },
      { name: 'build', detail: 'Run the default build script', featured: true },
      { name: 'test', detail: 'Run the default test script', featured: true },
      { name: 'lint', detail: 'Run the default lint script' },
    ],
  },
  {
    command: 'bun',
    detail: 'Run packages and scripts with Bun',
    subcommands: [
      { name: 'install', detail: 'Install dependencies', featured: true },
      { name: 'run', detail: 'Run a script', featured: true },
      { name: 'test', detail: 'Run tests', featured: true },
      { name: 'add', detail: 'Add a dependency' },
      { name: 'remove', detail: 'Remove a dependency' },
      { name: 'x', detail: 'Execute a package binary' },
    ],
  },
  { command: 'node', detail: 'Run Node.js programs' },
  { command: 'npx', detail: 'Run a package binary without installing it globally' },
  { command: 'python', detail: 'Run Python programs' },
  {
    command: 'python3',
    detail: 'Run Python programs',
    featured: true,
    subcommands: [
      {
        name: '-m',
        detail: 'Run a library module as a script',
        kind: 'option',
        featured: true,
        takesValue: true,
        valueHint: '<module>',
      },
      { name: '-V', detail: 'Show the Python version', kind: 'option' },
      {
        name: '-c',
        detail: 'Run Python code passed as a string',
        kind: 'option',
        takesValue: true,
        valueHint: '<code>',
      },
    ],
  },
  {
    command: 'pip',
    detail: 'Manage Python packages',
    subcommands: [
      { name: 'install', detail: 'Install packages', featured: true },
      { name: 'uninstall', detail: 'Remove packages' },
      { name: 'list', detail: 'List installed packages' },
      { name: 'show', detail: 'Show package metadata' },
      { name: 'freeze', detail: 'Output installed packages in requirements format' },
    ],
  },
  {
    command: 'pip3',
    detail: 'Manage Python packages for Python 3',
    subcommands: [
      { name: 'install', detail: 'Install packages', featured: true },
      { name: 'uninstall', detail: 'Remove packages' },
      { name: 'list', detail: 'List installed packages' },
    ],
  },
  {
    command: 'uv',
    detail: 'Manage Python environments and packages with uv',
    subcommands: [
      { name: 'sync', detail: 'Synchronize the environment from the lockfile', featured: true },
      { name: 'run', detail: 'Run a command inside the project environment', featured: true },
      { name: 'add', detail: 'Add a dependency', featured: true },
      { name: 'remove', detail: 'Remove a dependency' },
      {
        name: 'pip',
        detail: 'Use uv pip compatibility commands',
        subcommands: [
          { name: 'install', detail: 'Install a package', featured: true },
          { name: 'uninstall', detail: 'Remove a package' },
          { name: 'list', detail: 'List installed packages' },
        ],
      },
    ],
  },
  { command: 'pytest', detail: 'Run Python test suites' },
  {
    command: 'go',
    detail: 'Go toolchain',
    featured: true,
    subcommands: [
      { name: 'test', detail: 'Run Go tests', featured: true },
      { name: 'build', detail: 'Build packages and binaries', featured: true },
      { name: 'run', detail: 'Run a main package', featured: true },
      { name: 'fmt', detail: 'Format packages', featured: true },
      { name: 'vet', detail: 'Inspect suspicious constructs' },
      {
        name: 'mod',
        detail: 'Manage module dependencies',
        subcommands: [
          { name: 'tidy', detail: 'Add missing and remove unused modules', featured: true },
          { name: 'download', detail: 'Download modules to the cache' },
          { name: 'vendor', detail: 'Populate the vendor directory' },
        ],
      },
    ],
  },
  {
    command: 'cargo',
    detail: 'Rust package manager and build tool',
    subcommands: [
      { name: 'build', detail: 'Compile the current package', featured: true },
      { name: 'run', detail: 'Build and run the current package', featured: true },
      { name: 'test', detail: 'Run tests', featured: true },
      { name: 'fmt', detail: 'Format Rust code' },
      { name: 'clippy', detail: 'Run Rust lints' },
      { name: 'check', detail: 'Type-check the current package' },
      { name: 'update', detail: 'Update dependency versions in Cargo.lock' },
    ],
  },
];

const CLOUD_AND_PACKAGE_COMMANDS: readonly TerminalCommandCatalogEntry[] = [
  {
    command: 'docker',
    detail: 'Manage containers and images',
    featured: true,
    subcommands: [
      { name: 'ps', detail: 'List containers', featured: true },
      { name: 'images', detail: 'List images', featured: true },
      { name: 'logs', detail: 'Show container logs', featured: true },
      { name: 'exec', detail: 'Run a command in a container', featured: true },
      { name: 'run', detail: 'Run a command in a new container', featured: true },
      { name: 'build', detail: 'Build an image from a Dockerfile' },
      { name: 'pull', detail: 'Pull an image from a registry' },
      { name: 'push', detail: 'Push an image to a registry' },
      {
        name: 'compose',
        detail: 'Use Docker Compose',
        featured: true,
        subcommands: [
          {
            name: '-f',
            detail: 'Use a specific Compose file',
            kind: 'option',
            featured: true,
            pathContext: true,
            pathPreference: 'files',
            takesValue: true,
            valueHint: '<compose-file>',
          },
          {
            name: '--profile',
            detail: 'Enable a specific Compose profile',
            kind: 'option',
            takesValue: true,
            valueHint: '<profile>',
          },
          {
            name: '--project-name',
            detail: 'Override the Compose project name',
            kind: 'option',
            takesValue: true,
            valueHint: '<name>',
          },
          { name: 'up', detail: 'Create and start services', featured: true },
          { name: 'down', detail: 'Stop and remove services', featured: true },
          { name: 'ps', detail: 'List compose services' },
          { name: 'logs', detail: 'Show service logs', featured: true },
          { name: 'build', detail: 'Build compose services' },
          { name: 'pull', detail: 'Pull service images' },
          { name: 'exec', detail: 'Run a command in a service container' },
          { name: 'run', detail: 'Run a one-off service command' },
        ],
      },
    ],
  },
  {
    command: 'kubectl',
    detail: 'Manage Kubernetes clusters',
    subcommands: [
      {
        name: '-n',
        detail: 'Use a specific namespace',
        kind: 'option',
        featured: true,
        takesValue: true,
        valueHint: '<namespace>',
      },
      {
        name: '--context',
        detail: 'Use a specific kubeconfig context',
        kind: 'option',
        takesValue: true,
        valueHint: '<context>',
      },
      {
        name: 'get',
        detail: 'Display one or many resources',
        featured: true,
        subcommands: [
          { name: 'pods', detail: 'List pods', featured: true },
          { name: 'po', detail: 'List pods (short name)', featured: true },
          { name: 'deployments', detail: 'List deployments', featured: true },
          { name: 'deploy', detail: 'List deployments (short name)', featured: true },
          { name: 'services', detail: 'List services', featured: true },
          { name: 'svc', detail: 'List services (short name)', featured: true },
          { name: 'nodes', detail: 'List nodes' },
          { name: 'namespaces', detail: 'List namespaces' },
          { name: 'ns', detail: 'List namespaces (short name)' },
        ],
      },
      { name: 'describe', detail: 'Show detailed resource information', featured: true },
      {
        name: 'apply',
        detail: 'Apply a configuration to a resource',
        featured: true,
        subcommands: [
          {
            name: '-f',
            detail: 'Read the resource definition from a file',
            kind: 'option',
            featured: true,
            pathContext: true,
            pathPreference: 'files',
            takesValue: true,
            valueHint: '<file>',
          },
        ],
      },
      { name: 'delete', detail: 'Delete resources', featured: true },
      { name: 'logs', detail: 'Print logs for a container', featured: true },
      { name: 'exec', detail: 'Run a command in a container', featured: true },
      { name: 'port-forward', detail: 'Forward local ports to a pod' },
      { name: 'config', detail: 'Modify kubeconfig files' },
    ],
  },
  {
    command: 'helm',
    detail: 'Manage Kubernetes packages',
    subcommands: [
      { name: 'install', detail: 'Install a chart', featured: true },
      { name: 'upgrade', detail: 'Upgrade a release', featured: true },
      { name: 'uninstall', detail: 'Uninstall a release' },
      { name: 'list', detail: 'List releases' },
      { name: 'repo', detail: 'Manage chart repositories' },
    ],
  },
  {
    command: 'brew',
    detail: 'Manage packages with Homebrew',
    subcommands: [
      { name: 'install', detail: 'Install a formula or cask', featured: true },
      { name: 'upgrade', detail: 'Upgrade installed packages', featured: true },
      { name: 'uninstall', detail: 'Remove a formula or cask' },
      { name: 'list', detail: 'List installed packages' },
    ],
  },
  {
    command: 'apt',
    detail: 'Manage packages on Debian-based systems',
    subcommands: [
      { name: 'update', detail: 'Refresh package metadata', featured: true },
      { name: 'install', detail: 'Install packages', featured: true },
      { name: 'remove', detail: 'Remove packages' },
      { name: 'upgrade', detail: 'Upgrade installed packages' },
    ],
  },
  {
    command: 'apt-get',
    detail: 'Manage packages on Debian-based systems',
    subcommands: [
      { name: 'update', detail: 'Refresh package metadata', featured: true },
      { name: 'install', detail: 'Install packages', featured: true },
      { name: 'remove', detail: 'Remove packages' },
      { name: 'upgrade', detail: 'Upgrade installed packages' },
    ],
  },
];

export const TERMINAL_COMMAND_CATALOG: readonly TerminalCommandCatalogEntry[] = [
  ...FILE_SYSTEM_COMMANDS,
  ...SEARCH_AND_TEXT_COMMANDS,
  ...SYSTEM_COMMANDS,
  ...EDITOR_COMMANDS,
  ...ARCHIVE_AND_NETWORK_COMMANDS,
  ...RUNTIME_AND_BUILD_COMMANDS,
  ...CLOUD_AND_PACKAGE_COMMANDS,
];
