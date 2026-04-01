package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"strings"
)

const (
	exampleControlplaneURL = "https://region.example.invalid"
	exampleEnvID           = "env_123"
	exampleEnvToken        = "<token>"
	examplePasswordEnv     = "REDEVEN_LOCAL_UI_PASSWORD"
)

func rootHelpText() string {
	return strings.TrimLeft(fmt.Sprintf(`
redeven

Redeven runtime and Local UI launcher.

Usage:
  redeven <command> [flags]
  redeven help [command]

Commands:
  bootstrap   Exchange an environment token for local runtime config.
  run         Start the runtime in remote, hybrid, local, or desktop mode.
  search      Run web search using configured provider credentials.
  knowledge   Build or verify embedded knowledge bundle assets.
  version     Print build information.
  help        Show detailed help and startup examples.

Quick start:
  Bootstrap once, then run:
    redeven bootstrap --controlplane %[1]s --env-id %[2]s --env-token %[3]s
    redeven run --mode hybrid

  Local-only mode on this machine:
    redeven run --mode local

  Hybrid mode with a custom Local UI bind:
    redeven run --mode hybrid --local-ui-bind 127.0.0.1:24000

  Expose Local UI to another machine on a trusted network:
    %[4]s=replace-with-a-long-password \
    redeven run --mode hybrid --local-ui-bind 0.0.0.0:24000 --password-env %[4]s

  One-shot run without a separate bootstrap step:
    redeven run --mode hybrid --controlplane %[1]s --env-id %[2]s --env-token %[3]s

Run %[5]s for detailed usage.
`, exampleControlplaneURL, exampleEnvID, exampleEnvToken, examplePasswordEnv, "`redeven help <command>`"), "\n")
}

func bootstrapHelpText() string {
	return strings.TrimLeft(fmt.Sprintf(`
redeven bootstrap

Exchange an environment token for local runtime config.

Usage:
  redeven bootstrap --controlplane <url> --env-id <env_public_id> (--env-token <token> | --env-token-env <env_name>) [flags]

Required flags:
  --controlplane <url>              Controlplane base URL.
  --env-id <env_public_id>          Environment public ID.
  --env-token <token>               Environment token. "Bearer <token>" is also accepted.
  --env-token-env <env_name>        Read the environment token from an environment variable.

Optional flags:
  --agent-home-dir <path>           Runtime home dir for filesystem-facing features.
  --shell <command>                 Shell command (default: $SHELL or /bin/bash).
  --permission-policy <preset>      Local permission policy: execute_read, read_only, or execute_read_write.
  --log-format <json|text>          Log format override.
  --log-level <debug|info|warn|error>
                                    Log level override.
  --timeout <duration>              Bootstrap request timeout (default: 15s).

Writes by default:
  ~/.redeven/config.json
  ~/.redeven/

Examples:
  Minimal bootstrap:
    redeven bootstrap --controlplane %[1]s --env-id %[2]s --env-token %[3]s

  Bootstrap with a stricter permission preset:
    redeven bootstrap --controlplane %[1]s --env-id %[2]s --env-token %[3]s --permission-policy read_only

  Bootstrap, then start the runtime:
    redeven bootstrap --controlplane %[1]s --env-id %[2]s --env-token %[3]s
    redeven run --mode hybrid
`, exampleControlplaneURL, exampleEnvID, exampleEnvToken), "\n")
}

func runHelpText() string {
	return strings.TrimLeft(fmt.Sprintf(`
redeven run

Start the runtime in remote, hybrid, local, or desktop mode.

Usage:
  redeven run [flags]

Modes:
  remote    Connect to the control plane only. No Local UI is started.
  hybrid    Connect to the control plane and start the Local UI.
  local     Start the Local UI only. No bootstrap is required.
  desktop   Always start the Local UI. Connect to the control plane only when bootstrap config is already valid.

Bootstrap rules:
  - Recommended flow: run %[5]s once, then use %[6]s.
  - One-shot flow: pass --controlplane, --env-id, and either --env-token or --env-token-env to %[6]s.

Local UI bind rules:
  - Default bind: localhost:23998
  - Accepted examples: localhost:23998, 127.0.0.1:24000, 127.0.0.1:0, 0.0.0.0:24000, 192.168.1.11:24000
  - localhost:0 is rejected because dual-stack localhost listeners cannot share one dynamic port.
  - Non-loopback binds require an access password.

Password rules:
  - Set exactly one of --password, --password-stdin, --password-env, or --password-file.
  - --password-env and --password-file trigger startup verification in an interactive terminal.

Flags:
  --mode <remote|hybrid|local|desktop>
                                    Run mode (default: remote).
  --local-ui-bind <host:port>       Local UI bind address (default: localhost:23998).
  --controlplane <url>              Controlplane base URL for one-shot bootstrap.
  --env-id <env_public_id>          Environment public ID for one-shot bootstrap.
  --env-token <token>               Environment token for one-shot bootstrap.
  --env-token-env <env_name>        Read the environment token from an environment variable.
  --permission-policy <preset>      Local permission policy when bootstrapping inline.
  --password <password>             Access password for the Local UI.
  --password-stdin                  Read the Local UI password from stdin.
  --password-env <env_name>         Read the Local UI password from an environment variable.
  --password-file <path>            Read the Local UI password from a file.
  --desktop-managed                 Disable CLI self-upgrade for desktop-managed Local UI runs.
  --startup-report-file <path>      Write machine-readable Local UI readiness JSON.

Examples:
  Remote mode:
    redeven run --mode remote

  Hybrid mode after a separate bootstrap:
    redeven run --mode hybrid

  Local-only mode:
    redeven run --mode local

  Desktop shell mode:
    redeven run --mode desktop --desktop-managed --local-ui-bind 127.0.0.1:0

  Hybrid mode with a custom Local UI bind:
    redeven run --mode hybrid --local-ui-bind 127.0.0.1:24000

  Hybrid mode exposed to another machine on a trusted network:
    %[4]s=replace-with-a-long-password \
    redeven run --mode hybrid --local-ui-bind 0.0.0.0:24000 --password-env %[4]s

  One-shot hybrid run without a separate bootstrap step:
    redeven run --mode hybrid --controlplane %[1]s --env-id %[2]s --env-token %[3]s
`, exampleControlplaneURL, exampleEnvID, exampleEnvToken, examplePasswordEnv, "`redeven bootstrap`", "`redeven run`"), "\n")
}

func searchHelpText() string {
	return strings.TrimLeft(`
redeven search

Run web search using configured provider credentials.

Usage:
  redeven search [flags] <query>

Flags:
  --provider <name>                 Web search provider (default: brave).
  --count <n>                       Number of results to return (default: 5, max: 10).
  --format <json|text>              Output format (default: json).
  --config-path <path>              Config path override.
  --secrets-path <path>             Secrets path override.
  --timeout <duration>              Search timeout (default: 15s).

Examples:
  redeven search "redeven local ui bind"
  REDEVEN_BRAVE_API_KEY=<key> redeven search --format text "golang flag help"
`, "\n")
}

func knowledgeHelpText() string {
	return strings.TrimLeft(`
redeven knowledge

Build or verify embedded knowledge bundle assets.

Usage:
  redeven knowledge <command> [flags]
  redeven help knowledge bundle

Commands:
  bundle      Build or verify dist knowledge bundle assets from source files.

Examples:
  redeven knowledge bundle
  redeven knowledge bundle --verify-only
`, "\n")
}

func knowledgeBundleHelpText() string {
	return strings.TrimLeft(`
redeven knowledge bundle

Build or verify dist knowledge bundle assets from source files.

Usage:
  redeven knowledge bundle [flags]

Flags:
  --source-root <path>              Knowledge source root.
  --dist-root <path>                Dist output root.
  --verify-only                     Verify dist files without rewriting.
  --validate-source-only            Validate source files without reading dist.

Examples:
  redeven knowledge bundle
  redeven knowledge bundle --verify-only
  redeven knowledge bundle --validate-source-only
`, "\n")
}

func versionHelpText() string {
	return strings.TrimLeft(`
redeven version

Print build information for the current redeven binary.

Usage:
  redeven version
`, "\n")
}

func newCLIFlagSet(name string) *flag.FlagSet {
	fs := flag.NewFlagSet(name, flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	return fs
}

func isHelpToken(v string) bool {
	trimmed := strings.TrimSpace(strings.ToLower(v))
	return trimmed == "-h" || trimmed == "--help"
}

func normalizeHelpTopic(args []string) []string {
	out := make([]string, 0, len(args))
	for _, arg := range args {
		trimmed := strings.TrimSpace(strings.ToLower(arg))
		if trimmed == "" {
			continue
		}
		out = append(out, trimmed)
	}
	return out
}

func lookupHelpText(args []string) (string, bool) {
	switch strings.Join(normalizeHelpTopic(args), " ") {
	case "":
		return rootHelpText(), true
	case "bootstrap":
		return bootstrapHelpText(), true
	case "run":
		return runHelpText(), true
	case "search":
		return searchHelpText(), true
	case "knowledge":
		return knowledgeHelpText(), true
	case "knowledge bundle":
		return knowledgeBundleHelpText(), true
	case "version":
		return versionHelpText(), true
	default:
		return "", false
	}
}

func writeText(w io.Writer, text string) {
	if strings.TrimSpace(text) == "" {
		return
	}
	if !strings.HasSuffix(text, "\n") {
		text += "\n"
	}
	_, _ = io.WriteString(w, text)
}

func writeErrorWithHelp(w io.Writer, message string, detailLines []string, helpText string) {
	lines := make([]string, 0, 1+len(detailLines))
	if strings.TrimSpace(message) != "" {
		lines = append(lines, strings.TrimSpace(message))
	}
	for _, line := range detailLines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		lines = append(lines, line)
	}
	if len(lines) > 0 {
		writeText(w, strings.Join(lines, "\n"))
	}
	if strings.TrimSpace(helpText) != "" {
		if len(lines) > 0 {
			writeText(w, "")
			_, _ = io.WriteString(w, "\n")
		}
		writeText(w, helpText)
	}
}

func parseCommandFlags(fs *flag.FlagSet, args []string) error {
	if err := fs.Parse(args); err != nil {
		return err
	}
	return nil
}

func translateFlagParseError(commandPath string, err error) (string, []string) {
	if errors.Is(err, flag.ErrHelp) {
		return "", nil
	}
	msg := strings.TrimSpace(err.Error())
	if name := unknownFlagName(msg); name != "" {
		message := fmt.Sprintf("unknown flag for `redeven %s`: --%s", commandPath, name)
		details := []string{}
		if commandPath == "run" && name == "local-ui-port" {
			details = append(details,
				"Hint: `--local-ui-port` was replaced by `--local-ui-bind <host:port>`.",
				"Example: redeven run --mode hybrid --local-ui-bind 127.0.0.1:24000",
			)
		}
		return message, details
	}
	if name := missingValueFlagName(msg); name != "" {
		return fmt.Sprintf("missing value for flag `--%s` in `redeven %s`", name, commandPath),
			[]string{fmt.Sprintf("Hint: provide a value after `--%s` and retry.", name)}
	}
	return fmt.Sprintf("failed to parse flags for `redeven %s`: %s", commandPath, msg), nil
}

func unknownFlagName(msg string) string {
	const prefix = "flag provided but not defined: "
	if !strings.HasPrefix(msg, prefix) {
		return ""
	}
	name := strings.TrimSpace(strings.TrimPrefix(msg, prefix))
	name = strings.TrimLeft(name, "-")
	return name
}

func missingValueFlagName(msg string) string {
	const prefix = "flag needs an argument: "
	if !strings.HasPrefix(msg, prefix) {
		return ""
	}
	name := strings.TrimSpace(strings.TrimPrefix(msg, prefix))
	name = strings.TrimLeft(name, "-")
	return name
}

type requiredFlag struct {
	name  string
	value string
}

func findMissingFlags(flags ...requiredFlag) []string {
	missing := make([]string, 0, len(flags))
	for _, item := range flags {
		if strings.TrimSpace(item.value) == "" {
			missing = append(missing, item.name)
		}
	}
	return missing
}

func formatFlagList(names []string) string {
	switch len(names) {
	case 0:
		return ""
	case 1:
		return names[0]
	default:
		return strings.Join(names, ", ")
	}
}

func translatePasswordOptionError(err error) (string, []string) {
	var optErr *passwordOptionError
	if errors.As(err, &optErr) {
		switch optErr.kind {
		case passwordOptionErrorMultipleSources:
			return "invalid password flags: use only one of --password, --password-stdin, --password-env, or --password-file",
				[]string{"Hint: choose a single password source for one startup command."}
		case passwordOptionErrorStdinRead:
			return "invalid password flags: could not read password from stdin",
				[]string{
					"Hint: pipe the full access password into `redeven run --password-stdin` and retry.",
					fmt.Sprintf("Details: %v", optErr.cause),
				}
		case passwordOptionErrorStdinEmpty:
			return "invalid password flags: stdin password is empty",
				[]string{"Hint: pipe a non-empty access password into `redeven run --password-stdin` and retry."}
		case passwordOptionErrorEnvNotSet:
			return fmt.Sprintf("invalid password flags: password env var %q is not set", optErr.envName),
				[]string{
					fmt.Sprintf("Hint: export %s with a non-empty password before running `redeven run`.", optErr.envName),
					fmt.Sprintf("Example: %s=replace-with-a-long-password redeven run --mode hybrid --local-ui-bind 0.0.0.0:24000 --password-env %s", optErr.envName, optErr.envName),
				}
		case passwordOptionErrorEnvEmpty:
			return fmt.Sprintf("invalid password flags: password env var %q is empty", optErr.envName),
				[]string{fmt.Sprintf("Hint: set %s to a non-empty password and retry.", optErr.envName)}
		case passwordOptionErrorFileRead:
			return fmt.Sprintf("invalid password flags: could not read password file %q", optErr.path),
				[]string{
					"Hint: check that the file exists and is readable by the current user.",
					fmt.Sprintf("Details: %v", optErr.cause),
				}
		case passwordOptionErrorFileEmpty:
			return fmt.Sprintf("invalid password flags: password file %q is empty", optErr.path),
				[]string{"Hint: write the full access password to the file and retry."}
		}
	}
	return fmt.Sprintf("invalid password flags: %v", err), nil
}

func translateEnvTokenOptionError(err error, command string) (string, []string) {
	var optErr *envTokenOptionError
	if errors.As(err, &optErr) {
		switch optErr.kind {
		case envTokenOptionErrorMultipleSources:
			return "invalid environment token flags: use only one of --env-token or --env-token-env",
				[]string{fmt.Sprintf("Hint: choose a single environment token source for `%s`.", command)}
		case envTokenOptionErrorEnvNotSet:
			return fmt.Sprintf("invalid environment token flags: environment token env var %q is not set", optErr.envName),
				[]string{fmt.Sprintf("Hint: export %s with a non-empty token before running `%s`.", optErr.envName, command)}
		case envTokenOptionErrorEnvEmpty:
			return fmt.Sprintf("invalid environment token flags: environment token env var %q is empty", optErr.envName),
				[]string{fmt.Sprintf("Hint: set %s to a non-empty token and retry.", optErr.envName)}
		}
	}
	return fmt.Sprintf("invalid environment token flags: %v", err), nil
}

func translatePasswordVerificationError(err error) (string, []string) {
	switch {
	case errors.Is(err, errPasswordPromptRequiresTTY):
		return "password verification requires an interactive terminal",
			[]string{"Hint: rerun in an interactive terminal, or use --password or --password-stdin for non-interactive startup."}
	case errors.Is(err, errAccessPasswordVerificationFailed):
		return "password verification failed: access password verification failed",
			[]string{"Hint: enter the same password configured in --password-env or --password-file."}
	default:
		return fmt.Sprintf("password verification failed: %v", err), nil
	}
}
