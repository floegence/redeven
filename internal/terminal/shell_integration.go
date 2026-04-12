package terminal

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	termgo "github.com/floegence/floeterm/terminal-go"
)

const (
	redevenShellInitPathPrependSentinel = "__REDEVEN_TERMINAL_NO_PATH_PREPEND__"
	redevenShellInitFolder              = "redeven-terminal-shell-init"
)

type redevenShellInitEnvProvider struct {
	base termgo.ShellEnvProvider
}

func (p redevenShellInitEnvProvider) BuildEnv(shellPath string, workingDir string) ([]string, string, error) {
	base := p.base
	if base == nil {
		base = termgo.DefaultEnvProvider{}
	}

	env, pathPrepend, err := base.BuildEnv(shellPath, workingDir)
	if err != nil {
		return env, pathPrepend, err
	}
	if strings.TrimSpace(pathPrepend) != "" {
		return env, pathPrepend, nil
	}
	return env, redevenShellInitPathPrependSentinel, nil
}

type redevenShellInitPaths struct {
	baseDir string
}

func newRedevenShellInitPaths(baseDir string) redevenShellInitPaths {
	if strings.TrimSpace(baseDir) == "" {
		baseDir = defaultRedevenShellInitBaseDir()
	}
	return redevenShellInitPaths{baseDir: baseDir}
}

func (p redevenShellInitPaths) BaseDir() string    { return p.baseDir }
func (p redevenShellInitPaths) ZshDir() string     { return filepath.Join(p.baseDir, "zsh") }
func (p redevenShellInitPaths) BashRC() string     { return filepath.Join(p.baseDir, "bashrc") }
func (p redevenShellInitPaths) ZshRC() string      { return filepath.Join(p.ZshDir(), ".zshrc") }
func (p redevenShellInitPaths) FishConfig() string { return filepath.Join(p.baseDir, "config.fish") }
func (p redevenShellInitPaths) PosixRC() string    { return filepath.Join(p.baseDir, "shrc") }

func defaultRedevenShellInitBaseDir() string {
	if dir, err := os.UserCacheDir(); err == nil && strings.TrimSpace(dir) != "" {
		return filepath.Join(dir, "redeven", redevenShellInitFolder)
	}
	if home, err := os.UserHomeDir(); err == nil && strings.TrimSpace(home) != "" {
		return filepath.Join(home, ".redeven", redevenShellInitFolder)
	}
	return filepath.Join(os.TempDir(), redevenShellInitFolder)
}

type redevenShellInitWriter struct {
	BaseDir string
}

func (w redevenShellInitWriter) EnsureShellInitFiles(_ string) error {
	paths := newRedevenShellInitPaths(w.BaseDir)

	if err := os.MkdirAll(paths.BaseDir(), 0o755); err != nil {
		return fmt.Errorf("failed to create shell init directory: %w", err)
	}
	if err := os.MkdirAll(paths.ZshDir(), 0o755); err != nil {
		return fmt.Errorf("failed to create zsh shell init directory: %w", err)
	}

	files := map[string]string{
		paths.BashRC():     redevenBashInitScript(),
		paths.ZshRC():      redevenZshInitScript(),
		paths.FishConfig(): redevenFishInitScript(),
		paths.PosixRC():    redevenPosixInitScript(),
	}

	for path, content := range files {
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			return fmt.Errorf("failed to write %s: %w", filepath.Base(path), err)
		}
	}

	return nil
}

func shellPathPrependBashSnippet() string {
	return fmt.Sprintf(`if [ -n "$FLOETERM_PATH_PREPEND" ] && [ "$FLOETERM_PATH_PREPEND" != "%s" ]; then
    export PATH="$FLOETERM_PATH_PREPEND:$PATH"
fi
`, redevenShellInitPathPrependSentinel)
}

func shellPathPrependFishSnippet() string {
	return fmt.Sprintf(`if set -q FLOETERM_PATH_PREPEND; and test "$FLOETERM_PATH_PREPEND" != "%s"
    set -l prepend_paths (string split ':' $FLOETERM_PATH_PREPEND)
    for p in $prepend_paths
        if not contains $p $PATH
            set -gx PATH $p $PATH
        end
    end
end
`, redevenShellInitPathPrependSentinel)
}

func shellCWDEmitBashSnippet() string {
	return `__redeven_terminal_emit_cwd() {
    if [ -n "${PWD:-}" ]; then
        __redeven_terminal_osc "P;Cwd=$PWD"
    fi
}
`
}

func shellCWDEmitFishSnippet() string {
	return `function __redeven_terminal_emit_cwd
    if test -n "$PWD"
        __redeven_terminal_osc "P;Cwd=$PWD"
    end
end
`
}

func redevenBashInitScript() string {
	return `#!/bin/bash
# redeven shell integration - auto-generated, do not edit.

# Source user's original bash configuration.
if [ -f "$HOME/.bashrc" ]; then
    source "$HOME/.bashrc"
elif [ -f "$HOME/.bash_profile" ]; then
    source "$HOME/.bash_profile"
elif [ -f "$HOME/.profile" ]; then
    source "$HOME/.profile"
fi

# Inject floeterm paths (after user's rc to take priority).
` + shellPathPrependBashSnippet() + `
__redeven_terminal_osc() {
    printf '\033]633;%s\a' "$1"
}

` + shellCWDEmitBashSnippet() + `

__redeven_terminal_command_start() {
    if [ "${__redeven_terminal_at_prompt:-0}" = "1" ]; then
        __redeven_terminal_at_prompt=0
        __redeven_terminal_osc "B"
    fi
}

__redeven_terminal_precmd() {
    local exit_code=$?
    if [ "${__redeven_terminal_prompt_seen:-0}" = "1" ] && [ "${__redeven_terminal_at_prompt:-0}" = "0" ]; then
        __redeven_terminal_osc "D;$exit_code"
    fi
    __redeven_terminal_prompt_seen=1
    __redeven_terminal_at_prompt=1
    __redeven_terminal_emit_cwd
    __redeven_terminal_osc "A"
}

if [ -z "${__REDEVEN_TERMINAL_SHELL_INTEGRATION_LOADED:-}" ]; then
    export __REDEVEN_TERMINAL_SHELL_INTEGRATION_LOADED=1

    # Keep command lifecycle state in the parent shell.
    # A PS0 command substitution runs in a subshell on modern bash, which
    # means state mutations do not survive until PROMPT_COMMAND emits D;<code>.
    __redeven_terminal_existing_debug_trap=""
    if __redeven_terminal_trap_output=$(trap -p DEBUG 2>/dev/null); then
        __redeven_terminal_existing_debug_trap=$(printf '%s\n' "$__redeven_terminal_trap_output" | sed -E "s/^trap -- '(.*)' DEBUG$/\1/")
    fi
    __redeven_terminal_debug_trap() {
        __redeven_terminal_command_start
        if [ -n "${__redeven_terminal_existing_debug_trap:-}" ]; then
            eval "$__redeven_terminal_existing_debug_trap"
        fi
    }
    trap '__redeven_terminal_debug_trap' DEBUG

    if [ -n "${PROMPT_COMMAND:-}" ]; then
        PROMPT_COMMAND="__redeven_terminal_precmd;${PROMPT_COMMAND}"
    else
        PROMPT_COMMAND="__redeven_terminal_precmd"
    fi
fi
`
}

func redevenZshInitScript() string {
	homeDir, _ := os.UserHomeDir()
	if strings.TrimSpace(homeDir) == "" {
		homeDir = "$HOME"
	}

	return fmt.Sprintf(`# redeven shell integration - auto-generated, do not edit.

# Restore original ZDOTDIR for nested shells.
if [ -n "$FLOETERM_ORIGINAL_ZDOTDIR" ]; then
    export ZDOTDIR="$FLOETERM_ORIGINAL_ZDOTDIR"
else
    unset ZDOTDIR
fi

# Source global zsh configs first (system-wide).
if [ -f /etc/zsh/zshenv ]; then
    source /etc/zsh/zshenv
fi
if [ -f /etc/zsh/zshrc ]; then
    source /etc/zsh/zshrc
fi

# Source user's original zsh configuration.
if [ -f "%s/.zshrc" ]; then
    source "%s/.zshrc"
elif [ -f "%s/.zprofile" ]; then
    source "%s/.zprofile"
fi

# Inject floeterm paths (after user's rc to take priority).
%s
__redeven_terminal_osc() {
    printf '\033]633;%%s\a' "$1"
}

%s
__redeven_terminal_preexec() {
    __redeven_terminal_command_running=1
    __redeven_terminal_osc "B"
}

__redeven_terminal_precmd() {
    local exit_code=$?
    if [[ "${__redeven_terminal_prompt_seen:-0}" = "1" && "${__redeven_terminal_command_running:-0}" = "1" ]]; then
        __redeven_terminal_osc "D;$exit_code"
    fi
    __redeven_terminal_prompt_seen=1
    __redeven_terminal_command_running=0
    __redeven_terminal_emit_cwd
    __redeven_terminal_osc "A"
}

if [[ -z "${__REDEVEN_TERMINAL_SHELL_INTEGRATION_LOADED:-}" ]]; then
    export __REDEVEN_TERMINAL_SHELL_INTEGRATION_LOADED=1
    autoload -Uz add-zsh-hook 2>/dev/null || true
    if typeset -f add-zsh-hook >/dev/null 2>&1; then
        add-zsh-hook preexec __redeven_terminal_preexec
        add-zsh-hook precmd __redeven_terminal_precmd
    else
        typeset -ga preexec_functions precmd_functions
        preexec_functions+=(__redeven_terminal_preexec)
        precmd_functions+=(__redeven_terminal_precmd)
    fi
fi
`, homeDir, homeDir, homeDir, homeDir, shellPathPrependBashSnippet(), shellCWDEmitBashSnippet())
}

func redevenFishInitScript() string {
	homeDir, _ := os.UserHomeDir()
	if strings.TrimSpace(homeDir) == "" {
		homeDir = "$HOME"
	}

	return fmt.Sprintf(`# redeven shell integration - auto-generated, do not edit.

# Source user's original fish configuration.
if test -f "%s/.config/fish/config.fish"
    source "%s/.config/fish/config.fish"
end

# Inject floeterm paths (after user's config to take priority).
%s
function __redeven_terminal_osc --argument payload
    printf '\e]633;%%s\a' $payload
end

%s
set -g __redeven_terminal_prompt_seen 0
set -g __redeven_terminal_command_running 0

function __redeven_terminal_fish_preexec --on-event fish_preexec
    set -g __redeven_terminal_command_running 1
    __redeven_terminal_osc B
end

function __redeven_terminal_fish_postexec --on-event fish_postexec
    if test "$__redeven_terminal_prompt_seen" = "1" -a "$__redeven_terminal_command_running" = "1"
        __redeven_terminal_osc "D;$status"
    end
    set -g __redeven_terminal_command_running 0
end

if not functions -q __redeven_terminal_original_fish_prompt
    if functions -q fish_prompt
        functions -c fish_prompt __redeven_terminal_original_fish_prompt
    end

    function fish_prompt
        set -g __redeven_terminal_prompt_seen 1
        __redeven_terminal_emit_cwd
        __redeven_terminal_osc A
        if functions -q __redeven_terminal_original_fish_prompt
            __redeven_terminal_original_fish_prompt
        end
    end
end
`, homeDir, homeDir, shellPathPrependFishSnippet(), shellCWDEmitFishSnippet())
}

func redevenPosixInitScript() string {
	return `#!/bin/sh
# redeven shell integration - auto-generated, do not edit.

# Source user's original profile.
if [ -f "$HOME/.profile" ]; then
    . "$HOME/.profile"
fi

# Inject floeterm paths (after user's profile to take priority).
` + shellPathPrependBashSnippet() + `
# POSIX fallback shells intentionally do not inject command lifecycle markers.
# Their hook surface is too inconsistent to support a clean preexec/precmd integration.
`
}
