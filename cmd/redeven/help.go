package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"strings"
)

const (
	exampleProviderOrigin  = "https://redeven.test"
	exampleControlplaneURL = "https://dev.redeven.test"
	exampleEnvID           = "env_123"
	exampleBootstrapTicket = "<bootstrap-ticket>"
	examplePasswordEnv     = "REDEVEN_LOCAL_UI_PASSWORD"
	exampleBootstrapEnv    = "REDEVEN_BOOTSTRAP_TICKET"
)

func rootHelpText() string {
	return strings.TrimLeft(fmt.Sprintf(`
redeven

Redeven runtime and Local UI launcher.

Usage:
  redeven <command> [flags]
  redeven help [command]

Commands:
  bootstrap   Bind the Local Environment to a control-plane environment.
  run         Start the runtime in remote, hybrid, local, or desktop mode.
  desktop-bridge
              Run the Desktop runtime placement bridge over stdio.
  desktop-runtime-status
              Probe an already-running Desktop-managed runtime daemon.
  desktop-runtime-stop
              Stop an already-running Desktop-managed runtime daemon.
  desktop-model-source
              Connect Desktop Local Environment models to runtime-control.
  env         Inspect and plan Redeven environment lifecycle operations.
  targets     Inspect Redeven targets for local automation.
  search      Run web search using configured provider credentials.
  okf         Build or verify embedded OKF bundle assets.
  version     Print build information.
  help        Show detailed help and startup examples.

Quick start:
  Bind the Local Environment once, then run:
    redeven bootstrap --provider-origin %[1]s --controlplane %[2]s --env-id %[3]s --bootstrap-ticket %[4]s
    redeven run --mode hybrid

  Local-only mode on this device:
    redeven run --mode local

  Access this Local Environment from another device:
    Use Redeven Desktop, SSH port forwarding, or a Flowersec secure tunnel.

  One-shot Local Environment rebind without a separate bootstrap step:
    redeven run --mode hybrid --provider-origin %[1]s --controlplane %[2]s --env-id %[3]s --bootstrap-ticket %[4]s

Run %[6]s for detailed usage.
`, exampleProviderOrigin, exampleControlplaneURL, exampleEnvID, exampleBootstrapTicket, examplePasswordEnv, "`redeven help <command>`"), "\n")
}

func desktopBridgeHelpText() string {
	return strings.TrimLeft(`
redeven desktop-bridge

Run the Desktop runtime placement bridge over stdio.

Usage:
  redeven desktop-bridge [flags]

This command is intended for Redeven Desktop managed runtime targets. It
exposes the Local UI and Desktop runtime-control to Desktop through the
versioned placement bridge protocol without requiring a published container
port. It attaches to an already-running runtime daemon and never starts a
runtime process.

Flags:
  --state-root <path>              State root override (default: $REDEVEN_STATE_ROOT or ~/.redeven).
  --probe-timeout <duration>       Runtime health probe timeout.
`, "\n")
}

func desktopRuntimeStatusHelpText() string {
	return strings.TrimLeft(`
redeven desktop-runtime-status

Probe an already-running Desktop-managed runtime daemon and print its startup
metadata as JSON.

Usage:
  redeven desktop-runtime-status [flags]

Flags:
  --state-root <path>              State root override (default: $REDEVEN_STATE_ROOT or ~/.redeven).
  --probe-timeout <duration>       Runtime health probe timeout.
`, "\n")
}

func desktopRuntimeStopHelpText() string {
	return strings.TrimLeft(`
redeven desktop-runtime-stop

Stop an already-running Desktop-managed runtime daemon. This command is used by
explicit Desktop Stop Runtime operations; Open and Reconnect do not call it.

Usage:
  redeven desktop-runtime-stop [flags]

Flags:
  --state-root <path>              State root override (default: $REDEVEN_STATE_ROOT or ~/.redeven).
  --probe-timeout <duration>       Runtime health probe timeout.
  --grace-period <duration>        Time to wait after requesting runtime shutdown.
`, "\n")
}

func desktopModelSourceHelpText() string {
	return strings.TrimLeft(`
redeven desktop-model-source

Connect Desktop Local Environment model settings to a Desktop-managed runtime
through runtime-control. This command is intended to be launched by Redeven
Desktop, not typed directly by users.

Usage:
  redeven desktop-model-source --runtime-control-url URL --runtime-control-token-env NAME --desktop-owner-id ID --session-id ID [flags]

Flags:
  --state-root PATH
      State root override (default: $REDEVEN_STATE_ROOT or ~/.redeven).
  --runtime-control-url URL
      Runtime-control service root URL.
  --runtime-control-token-env NAME
      Environment variable that contains the runtime-control bearer token.
  --runtime-control-token TOKEN
      Runtime-control bearer token. Prefer --runtime-control-token-env.
  --desktop-owner-id ID
      Desktop owner id expected by the runtime.
  --session-id ID
      Desktop model source session id.
  --expires-at-unix-ms VALUE
      Optional session expiration in Unix milliseconds.
  --startup-report-file PATH
      Optional JSON readiness report path.
`, "\n")
}

func bootstrapHelpText() string {
	return strings.TrimLeft(fmt.Sprintf(`
redeven bootstrap

Bind the Local Environment to a control-plane environment.

Usage:
  redeven bootstrap --provider-origin <url> --controlplane <url> --env-id <env_public_id> [ticket flags] [flags]

Required flags:
  --provider-origin <url>           Provider authority origin.
  --controlplane <url>              Access point controlplane base URL.
  --env-id <env_public_id>          Environment public ID.
  One bootstrap ticket:
    --bootstrap-ticket <ticket>       One-time bootstrap ticket. "Bearer <ticket>" is also accepted.
    --bootstrap-ticket-env <env_name> Read the bootstrap ticket from an environment variable.

Optional flags:
  --state-root <path>              State root override (default: $REDEVEN_STATE_ROOT or ~/.redeven).
  --agent-home-dir <path>           Runtime home dir for filesystem-facing features.
  --shell <command>                 Shell command (default: $SHELL or /bin/bash).
  --permission-policy <preset>      Local permission policy: execute_read (modeled execute actions, no shell/process),
                                    read_only, or execute_read_write.
  --log-format <json|text>          Log format override.
  --log-level <debug|info|warn|error>
                                    Log level override.
  --timeout <duration>              Bootstrap request timeout (default: 15s).

Local Environment state:
  - Default target: ~/.redeven/local-environment/config.json.
  - Rebinding replaces the current Local Environment control-plane binding.
  - Use --state-root only when this OS user needs an isolated Redeven profile root.

Writes by default:
  ~/.redeven/local-environment/config.json

Examples:
  Minimal bootstrap:
    redeven bootstrap --provider-origin %[1]s --controlplane %[2]s --env-id %[3]s --bootstrap-ticket %[4]s

  Bootstrap from a one-time desktop handoff ticket:
    redeven bootstrap --provider-origin %[1]s --controlplane %[2]s --env-id %[3]s --bootstrap-ticket %[4]s

  Bootstrap with a stricter permission preset:
    redeven bootstrap --provider-origin %[1]s --controlplane %[2]s --env-id %[3]s --bootstrap-ticket %[4]s --permission-policy read_only

  Bootstrap, then start the runtime:
    redeven bootstrap --provider-origin %[1]s --controlplane %[2]s --env-id %[3]s --bootstrap-ticket %[4]s
    redeven run --mode hybrid
`, exampleProviderOrigin, exampleControlplaneURL, exampleEnvID, exampleBootstrapTicket), "\n")
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
  - One-shot flow: pass --provider-origin, --controlplane, --env-id, and a one-time bootstrap ticket to %[6]s.

Local Environment state rules:
  - Redeven uses one Local Environment state at ~/.redeven/local-environment.
  - Inline bootstrap flags rebind the same Local Environment state before startup.
  - Use --state-root to relocate the whole Local Environment state root, including desktop-managed SSH runtimes.

Local UI bind rules:
  - Default bind: localhost:23998
  - Accepted examples: localhost:23998, 127.0.0.1:24000, 127.42.0.9:24000, 127.0.0.1:0, [::1]:24000
	  - localhost:0 is rejected because dual-stack localhost listeners cannot share one dynamic port.
	  - Local UI is permanently loopback-only. Use Redeven Desktop, SSH forwarding, or a Flowersec secure tunnel across devices.

Password rules:
  - Set exactly one of --password, --password-stdin, --password-env, or --password-file.
  - --password-env and --password-file trigger startup verification in an interactive terminal.

Rich terminal controls:
  - Arrow keys move focus between Control plane, Sessions, and Logs.
  - Enter on Sessions opens the active-session view; type to filter by user, app, channel, or target.
  - Enter on Logs opens the full runtime log view; Esc returns to the overview.
  - Enter on Control plane connects or disconnects when remote config is valid.
  - If remote config is missing, Enter opens Provider, Access Point, Environment, and bootstrap ticket setup fields.

Flags:
  --mode <remote|hybrid|local|desktop>
                                    Run mode (default: remote).
  --local-ui-bind <host:port>       Local UI bind address (default: localhost:23998).
  --provider-origin <url>           Provider authority origin for one-shot bootstrap.
  --controlplane <url>              Access point controlplane base URL for one-shot bootstrap.
  --env-id <env_public_id>          Environment public ID for one-shot bootstrap.
  --bootstrap-ticket <ticket>       One-time bootstrap ticket for one-shot bootstrap.
  --bootstrap-ticket-env <env_name> Read the bootstrap ticket from an environment variable.
  --permission-policy <preset>      Local permission policy when bootstrapping inline.
  --password <password>             Access password for the Local UI.
  --password-stdin                  Read the Local UI password from stdin.
  --password-env <env_name>         Read the Local UI password from an environment variable.
  --password-file <path>            Read the Local UI password from a file.
  --state-root <path>               State root override (default: $REDEVEN_STATE_ROOT or ~/.redeven).
  --desktop-managed                 Disable CLI self-upgrade for desktop-managed Local UI runs.
  --startup-report-file <path>      Write structured Local UI readiness JSON.
  --presentation <auto|rich|plain|machine>
                                    Startup presentation (default: auto).

Examples:
  Remote mode:
    redeven run --mode remote

  Hybrid mode after a separate bootstrap:
    redeven run --mode hybrid

  Local-only mode:
    redeven run --mode local

  Desktop shell mode:
    redeven run --mode desktop --desktop-managed --presentation machine --local-ui-bind 127.0.0.1:0

  Cross-device access:
    Keep Local UI on loopback and use Redeven Desktop, SSH forwarding, or a Flowersec secure tunnel.

  One-shot hybrid run without a separate bootstrap step:
    redeven run --mode hybrid --provider-origin %[1]s --controlplane %[2]s --env-id %[3]s --bootstrap-ticket %[4]s

  One-shot desktop handoff run with a bootstrap ticket:
    %[7]s=%[4]s redeven run --mode desktop --desktop-managed --presentation machine --provider-origin %[1]s --controlplane %[2]s --env-id %[3]s --bootstrap-ticket-env %[7]s
`, exampleProviderOrigin, exampleControlplaneURL, exampleEnvID, exampleBootstrapTicket, "`redeven bootstrap`", "`redeven run`", exampleBootstrapEnv, examplePasswordEnv), "\n")
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
  --state-root <path>               State root override (default: $REDEVEN_STATE_ROOT or ~/.redeven).
  --secrets-path <path>             Secrets path override.
  --timeout <duration>              Search timeout (default: 15s).

Examples:
  redeven search "redeven local ui bind"
  REDEVEN_BRAVE_API_KEY=<key> redeven search --format text "golang flag help"
`, "\n")
}

func targetsHelpText() string {
	return strings.TrimLeft(`
redeven targets

Inspect Redeven targets for local automation.

Usage:
  redeven targets <command> [flags]
  redeven help targets list
  redeven help targets resolve
  redeven help targets exec

Commands:
  list       List discoverable targets.
  resolve    Resolve one target id, current alias, label, env_public_id, or local_environment_public_id.
  exec       Execute an agent-selected shell command on a supported target.

Examples:
  redeven targets list
  redeven targets list --json
  redeven targets resolve --target local --json
  redeven targets exec --target current --command 'uname -a' --json
`, "\n")
}

func targetsListHelpText() string {
	return strings.TrimLeft(`
redeven targets list

List discoverable Redeven targets.

Usage:
  redeven targets list [flags]

Flags:
  --json                            Write the protocol JSON envelope.
  --state-root <path>               State root override (default: $REDEVEN_STATE_ROOT or ~/.redeven).

Examples:
  redeven targets list
  redeven targets list --json
`, "\n")
}

func targetsResolveHelpText() string {
	return strings.TrimLeft(`
redeven targets resolve

Resolve one target id, current alias, label, env_public_id, or local_environment_public_id.

Usage:
  redeven targets resolve --target <target> [flags]

Flags:
  --target <target>                 Target id, current, label, env_public_id, or local_environment_public_id.
  --json                            Write the protocol JSON envelope.
  --state-root <path>               State root override (default: $REDEVEN_STATE_ROOT or ~/.redeven).

Examples:
  redeven targets resolve --target current
  redeven targets resolve --target local
  redeven targets resolve --target local:local --json
	`, "\n")
}

func targetsExecHelpText() string {
	return strings.TrimLeft(`
redeven targets exec

Execute a shell command on a supported Redeven target through a structured
target execution contract.

This command is for target OS diagnostics and small command probes chosen by an
agent or user, such as time, uptime, kernel, disk, process, package manager, or
service checks. Environment lifecycle actions still belong to redeven env.

Supported execution locations:
  local_runtime     Default Local Environment shell.
  local_host        Saved local host runtime target.
  ssh_target        Saved SSH host/runtime target using key or agent auth.

Unsupported targets return a JSON result with supported=false and reason_code
instead of falling back to Docker, systemd, launchctl, or ad hoc process manager
commands.

Usage:
  redeven targets exec --target <target> --command <command> [flags]

Flags:
  --target <target>                 Target id, current, label, env_public_id, or local_environment_public_id (default: current).
  --command <command>               Shell command to execute on the target.
  --cwd <path>                      Working directory on the selected target.
  --timeout <duration>              Command timeout (default: 120s, max: 10m).
  --json                            Write the protocol JSON envelope.
  --state-root <path>               State root override (default: $REDEVEN_STATE_ROOT or ~/.redeven).

Examples:
  redeven targets exec --target current --command 'date' --json
  redeven targets exec --target ssh:devbox --command 'uname -a' --json
`, "\n")
}

func envHelpText() string {
	return strings.TrimLeft(`
redeven env

Inspect Redeven environments and plan lifecycle operations through a stable
machine-readable contract. Flower and automation should use this command for
environment status, runtime attach diagnostics, stop, start, restart, and update requests
instead of inferring Docker, SSH, systemd, or process-manager commands from a
target id.

Usage:
  redeven env <command> [flags]
  redeven help env list
  redeven help env resolve
  redeven help env status
  redeven help env diagnose
  redeven help env stop
  redeven help env start
  redeven help env restart
  redeven help env update

Commands:
  list       List discoverable environments.
  resolve    Resolve an environment target into Redeven environment semantics.
  status     Inspect sanitized runtime status and available operation plans.
  diagnose   Inspect status plus runtime attach diagnostics.
  stop       Stop a supported Desktop-managed Local Environment runtime.
  start      Return the structured start plan for an environment target.
  restart    Return the structured restart plan for an environment target.
  update     Return the structured update plan for an environment target.

Examples:
  redeven env list --json
  redeven env status --target current --json
  redeven env status --target local --json
  redeven env restart --target local:container:docker:dev:abcd1234 --json
`, "\n")
}

func envListHelpText() string {
	return strings.TrimLeft(`
redeven env list

List discoverable Redeven environments.

Usage:
  redeven env list [flags]

Flags:
  --json                            Write the protocol JSON envelope.
  --state-root <path>               State root override (default: $REDEVEN_STATE_ROOT or ~/.redeven).

Examples:
  redeven env list --json
`, "\n")
}

func envResolveHelpText() string {
	return strings.TrimLeft(`
redeven env resolve

Resolve an environment target. Recognized but unsupported target shapes return
a successful structured result with supported=false and a reason_code instead
of falling back to low-level Docker or SSH semantics.

Usage:
  redeven env resolve --target <target> [flags]

Flags:
  --target <target>                 Environment target id, current, label, env_public_id, or recognized Redeven target shape.
  --json                            Write the protocol JSON envelope.
  --state-root <path>               State root override (default: $REDEVEN_STATE_ROOT or ~/.redeven).

Examples:
  redeven env resolve --target current --json
  redeven env resolve --target local --json
  redeven env resolve --target local:container:docker:dev:abcd1234 --json
`, "\n")
}

func envStatusHelpText() string {
	return strings.TrimLeft(`
redeven env status

Inspect sanitized Redeven environment runtime status and operation plans. This
output intentionally omits local state/config/socket paths, runtime-control
tokens, and raw Desktop launch reports; diagnostic commands may still include
local diagnostic paths.

Usage:
  redeven env status [flags]

Flags:
  --target <target>                 Environment target id, current, label, env_public_id, or recognized Redeven target shape.
  --json                            Write the protocol JSON envelope.
  --state-root <path>               State root override (default: $REDEVEN_STATE_ROOT or ~/.redeven).
  --probe-timeout <duration>        Runtime health probe timeout.

Examples:
  redeven env status --target current --json
  redeven env status --target local --json
`, "\n")
}

func envDiagnoseHelpText() string {
	return strings.TrimLeft(`
redeven env diagnose

Inspect sanitized Redeven environment runtime status with attach diagnostics.

Usage:
  redeven env diagnose [flags]

Flags:
  --target <target>                 Environment target id, current, label, env_public_id, or recognized Redeven target shape.
  --json                            Write the protocol JSON envelope.
  --state-root <path>               State root override (default: $REDEVEN_STATE_ROOT or ~/.redeven).
  --probe-timeout <duration>        Runtime health probe timeout.

Examples:
  redeven env diagnose --target current --json
  redeven env diagnose --target local --json
`, "\n")
}

func envOperationHelpText(operation string) string {
	switch strings.TrimSpace(strings.ToLower(operation)) {
	case "stop":
		return envStopHelpText()
	case "start":
		return envStartHelpText()
	case "restart":
		return envRestartHelpText()
	case "update":
		return envUpdateHelpText()
	default:
		return envHelpText()
	}
}

func envStopHelpText() string {
	return strings.TrimLeft(`
redeven env stop

Stop a supported Desktop-managed Local Environment runtime, or return a
structured unavailable/blocked plan when the target is unsupported or owned by
another runtime surface.

Usage:
  redeven env stop [flags]

Flags:
  --target <target>                 Environment target id, current, label, env_public_id, or recognized Redeven target shape.
  --json                            Write the protocol JSON envelope.
  --state-root <path>               State root override (default: $REDEVEN_STATE_ROOT or ~/.redeven).
  --probe-timeout <duration>        Runtime health probe timeout.
  --grace-period <duration>         Time to wait after requesting runtime shutdown.

Examples:
  redeven env stop --target local --json
`, "\n")
}

func envStartHelpText() string {
	return strings.TrimLeft(`
redeven env start

Return the structured start plan for an environment target. Phase one does not
start Desktop runtime sessions from this CLI; use Redeven Desktop when the plan
requires Desktop handoff.

Usage:
  redeven env start [flags]

Flags:
  --target <target>                 Environment target id, current, label, env_public_id, or recognized Redeven target shape.
  --json                            Write the protocol JSON envelope.
  --state-root <path>               State root override (default: $REDEVEN_STATE_ROOT or ~/.redeven).
  --probe-timeout <duration>        Runtime health probe timeout.

Examples:
  redeven env start --target local --json
`, "\n")
}

func envRestartHelpText() string {
	return strings.TrimLeft(`
redeven env restart

Return the structured restart plan for an environment target. Phase one does
not restart Desktop runtime sessions from this CLI and never infers Docker,
SSH, or systemd commands from the target id.

Usage:
  redeven env restart [flags]

Flags:
  --target <target>                 Environment target id, current, label, env_public_id, or recognized Redeven target shape.
  --json                            Write the protocol JSON envelope.
  --state-root <path>               State root override (default: $REDEVEN_STATE_ROOT or ~/.redeven).
  --probe-timeout <duration>        Runtime health probe timeout.

Examples:
  redeven env restart --target local:container:docker:dev:abcd1234 --json
`, "\n")
}

func envUpdateHelpText() string {
	return strings.TrimLeft(`
redeven env update

Return the structured update plan for an environment target. Phase one reports
Desktop update handoff requirements without mutating runtimes.

Usage:
  redeven env update [flags]

Flags:
  --target <target>                 Environment target id, current, label, env_public_id, or recognized Redeven target shape.
  --json                            Write the protocol JSON envelope.
  --state-root <path>               State root override (default: $REDEVEN_STATE_ROOT or ~/.redeven).
  --probe-timeout <duration>        Runtime health probe timeout.

Examples:
  redeven env update --target local --json
`, "\n")
}

func okfHelpText() string {
	return strings.TrimLeft(`
redeven okf

Build or verify embedded OKF bundle assets.

Usage:
  redeven okf <command> [flags]
  redeven help okf bundle

Commands:
  bundle      Build or verify dist OKF bundle assets from source files.

Examples:
  redeven okf bundle
  redeven okf bundle --verify-only
`, "\n")
}

func okfBundleHelpText() string {
	return strings.TrimLeft(`
redeven okf bundle

Build or verify dist OKF bundle assets from source files.

Usage:
  redeven okf bundle [flags]

Flags:
  --source-root <path>              OKF source root.
  --dist-root <path>                Dist output root.
  --verify-only                     Verify dist files without rewriting.
  --validate-source-only            Validate source files without reading dist.

Examples:
  redeven okf bundle
  redeven okf bundle --verify-only
  redeven okf bundle --validate-source-only
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
	case "desktop-bridge":
		return desktopBridgeHelpText(), true
	case "desktop-runtime-status":
		return desktopRuntimeStatusHelpText(), true
	case "desktop-runtime-stop":
		return desktopRuntimeStopHelpText(), true
	case "desktop-model-source":
		return desktopModelSourceHelpText(), true
	case "env":
		return envHelpText(), true
	case "env list":
		return envListHelpText(), true
	case "env resolve":
		return envResolveHelpText(), true
	case "env status":
		return envStatusHelpText(), true
	case "env diagnose":
		return envDiagnoseHelpText(), true
	case "env stop":
		return envStopHelpText(), true
	case "env start":
		return envStartHelpText(), true
	case "env restart":
		return envRestartHelpText(), true
	case "env update":
		return envUpdateHelpText(), true
	case "targets":
		return targetsHelpText(), true
	case "targets list":
		return targetsListHelpText(), true
	case "targets resolve":
		return targetsResolveHelpText(), true
	case "targets exec":
		return targetsExecHelpText(), true
	case "search":
		return searchHelpText(), true
	case "okf":
		return okfHelpText(), true
	case "okf bundle":
		return okfBundleHelpText(), true
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
					fmt.Sprintf("Example: %s=replace-with-a-long-password redeven run --mode hybrid --password-env %s", optErr.envName, optErr.envName),
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

func translateBootstrapTicketOptionError(err error, command string) (string, []string) {
	var optErr *bootstrapTicketOptionError
	if errors.As(err, &optErr) {
		switch optErr.kind {
		case bootstrapTicketOptionErrorMultipleSources:
			return "invalid bootstrap ticket flags: use only one of --bootstrap-ticket or --bootstrap-ticket-env",
				[]string{fmt.Sprintf("Hint: choose a single bootstrap ticket source for `%s`.", command)}
		case bootstrapTicketOptionErrorEnvNotSet:
			return fmt.Sprintf("invalid bootstrap ticket flags: bootstrap ticket env var %q is not set", optErr.envName),
				[]string{fmt.Sprintf("Hint: export %s with a non-empty ticket before running `%s`.", optErr.envName, command)}
		case bootstrapTicketOptionErrorEnvEmpty:
			return fmt.Sprintf("invalid bootstrap ticket flags: bootstrap ticket env var %q is empty", optErr.envName),
				[]string{fmt.Sprintf("Hint: set %s to a non-empty ticket and retry.", optErr.envName)}
		}
	}
	return fmt.Sprintf("invalid bootstrap ticket flags: %v", err), nil
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
