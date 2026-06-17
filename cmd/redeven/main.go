package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/floegence/redeven/internal/agent"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/localui"
	"github.com/floegence/redeven/internal/lockfile"
	"github.com/floegence/redeven/internal/runtimepresentation"
)

var (
	// Version is set via -ldflags at build time.
	Version = "dev"
	// Commit is set via -ldflags at build time.
	Commit = "unknown"
	// BuildTime is set via -ldflags at build time.
	BuildTime = "unknown"
)

const desktopOwnerIDEnvName = "REDEVEN_DESKTOP_OWNER_ID"

type cli struct {
	stdin  io.Reader
	stdout io.Writer
	stderr io.Writer
}

func main() {
	os.Exit(runCLI(os.Args[1:], os.Stdin, os.Stdout, os.Stderr))
}

func runCLI(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	return (&cli{stdin: stdin, stdout: stdout, stderr: stderr}).run(args)
}

func (c *cli) run(args []string) int {
	if len(args) == 0 {
		writeText(c.stderr, rootHelpText())
		return 2
	}

	if isHelpToken(args[0]) {
		writeText(c.stdout, rootHelpText())
		return 0
	}

	switch strings.TrimSpace(strings.ToLower(args[0])) {
	case "help":
		return c.helpCmd(args[1:])
	case "bootstrap":
		return c.bootstrapCmd(args[1:])
	case "run":
		return c.runCmd(args[1:])
	case "desktop-bridge":
		return c.desktopBridgeCmd(args[1:])
	case "desktop-runtime-status":
		return c.desktopRuntimeStatusCmd(args[1:])
	case "desktop-runtime-stop":
		return c.desktopRuntimeStopCmd(args[1:])
	case "desktop-model-source":
		return c.desktopModelSourceCmd(args[1:])
	case "search":
		return c.searchCmd(args[1:])
	case "okf":
		return c.okfCmd(args[1:])
	case "targets":
		return c.targetsCmd(args[1:])
	case "version":
		if len(args) > 1 && isHelpToken(args[1]) {
			writeText(c.stdout, versionHelpText())
			return 0
		}
		fmt.Fprintf(c.stdout, "redeven %s (%s) %s\n", Version, Commit, BuildTime)
		return 0
	default:
		writeErrorWithHelp(
			c.stderr,
			fmt.Sprintf("unknown command: %s", strings.TrimSpace(args[0])),
			[]string{"Run `redeven help` for usage and startup examples."},
			rootHelpText(),
		)
		return 2
	}
}

func (c *cli) helpCmd(args []string) int {
	text, ok := lookupHelpText(args)
	if !ok {
		topic := strings.TrimSpace(strings.Join(args, " "))
		if topic == "" {
			topic = "<empty>"
		}
		writeErrorWithHelp(
			c.stderr,
			fmt.Sprintf("unknown help topic: %s", topic),
			[]string{"Run `redeven help` for available commands."},
			rootHelpText(),
		)
		return 2
	}
	writeText(c.stdout, text)
	return 0
}

func (c *cli) bootstrapCmd(args []string) int {
	fs := newCLIFlagSet("bootstrap")

	providerOrigin := fs.String("provider-origin", "", "Provider origin (e.g. https://redeven.test)")
	controlplane := fs.String("controlplane", "", "Access point controlplane base URL (e.g. https://dev.redeven.test)")
	envID := fs.String("env-id", "", "Environment public ID (env_...)")
	bootstrapTicket := fs.String("bootstrap-ticket", "", "One-time bootstrap ticket (raw ticket; 'Bearer <ticket>' is also accepted)")
	bootstrapTicketEnv := fs.String("bootstrap-ticket-env", "", "Environment variable name holding the bootstrap ticket")
	stateRoot := fs.String("state-root", "", "State root override (default: $REDEVEN_STATE_ROOT or ~/.redeven)")

	agentHomeDir := fs.String("agent-home-dir", "", "Runtime home dir used for filesystem-facing features (default: user home dir)")
	shell := fs.String("shell", "", "Shell command (default: $SHELL or /bin/bash)")

	permissionPolicy := fs.String("permission-policy", "", "Local permission policy preset: execute_read|read_only|execute_read_write (empty: keep existing; default: execute_read_write)")

	logFormat := fs.String("log-format", "", "Log format: json|text (empty: default json)")
	logLevel := fs.String("log-level", "", "Log level: debug|info|warn|error (empty: default info)")

	timeout := fs.Duration("timeout", 15*time.Second, "Bootstrap request timeout")

	if err := parseCommandFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			writeText(c.stdout, bootstrapHelpText())
			return 0
		}
		message, details := translateFlagParseError("bootstrap", err)
		writeErrorWithHelp(c.stderr, message, details, bootstrapHelpText())
		return 2
	}

	resolvedBootstrapTicket, err := resolveBootstrapTicket(bootstrapTicketOptions{
		ticket:    *bootstrapTicket,
		ticketEnv: *bootstrapTicketEnv,
	})
	if err != nil {
		message, details := translateBootstrapTicketOptionError(err, "redeven bootstrap")
		writeErrorWithHelp(c.stderr, message, details, bootstrapHelpText())
		return 2
	}
	missing := findMissingFlags(
		requiredFlag{name: "--provider-origin", value: *providerOrigin},
		requiredFlag{name: "--controlplane", value: *controlplane},
		requiredFlag{name: "--env-id", value: *envID},
		requiredFlag{name: "one bootstrap ticket (--bootstrap-ticket or --bootstrap-ticket-env)", value: resolvedBootstrapTicket},
	)
	if len(missing) > 0 {
		writeErrorWithHelp(
			c.stderr,
			fmt.Sprintf("missing required flags for `redeven bootstrap`: %s", formatFlagList(missing)),
			[]string{
				fmt.Sprintf(
					"Example: redeven bootstrap --provider-origin %s --controlplane %s --env-id %s --bootstrap-ticket %s",
					exampleProviderOrigin,
					exampleControlplaneURL,
					exampleEnvID,
					exampleBootstrapTicket,
				),
			},
			bootstrapHelpText(),
		)
		return 2
	}

	stateLayout, err := resolveBootstrapTargetLayout(*stateRoot)
	if err != nil {
		return c.printRunStateLayoutGuidance(err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()

	_, err = config.BootstrapConfig(ctx, config.BootstrapArgs{
		ProviderOrigin:         *providerOrigin,
		ControlplaneBaseURL:    *controlplane,
		EnvironmentID:          *envID,
		BootstrapTicket:        resolvedBootstrapTicket,
		RuntimeVersion:         Version,
		StateRoot:              stateLayout.StateRoot,
		AgentHomeDir:           *agentHomeDir,
		Shell:                  *shell,
		LogFormat:              *logFormat,
		LogLevel:               *logLevel,
		PermissionPolicyPreset: *permissionPolicy,
	})
	if err != nil {
		fmt.Fprintf(c.stderr, "bootstrap failed: %v\n", err)
		return 1
	}

	fmt.Fprintf(c.stdout, "Bootstrap complete.\n")
	fmt.Fprintf(c.stdout, "Config: %s\n", stateLayout.ConfigPath)
	fmt.Fprintf(c.stdout, "Next: redeven run --mode hybrid\n")
	return 0
}

func (c *cli) runCmd(args []string) int {
	fs := newCLIFlagSet("run")
	providerOrigin := fs.String("provider-origin", "", "Provider origin for one-shot Local Environment rebind")
	controlplane := fs.String("controlplane", "", "Access point controlplane base URL for one-shot Local Environment rebind")
	envID := fs.String("env-id", "", "Environment public ID (env_...)")
	bootstrapTicket := fs.String("bootstrap-ticket", "", "One-time bootstrap ticket")
	bootstrapTicketEnv := fs.String("bootstrap-ticket-env", "", "Environment variable name holding the bootstrap ticket")
	permissionPolicy := fs.String("permission-policy", "", "Local permission policy preset: execute_read|read_only|execute_read_write (optional; applies when bootstrapping)")
	stateRoot := fs.String("state-root", "", "State root override (default: $REDEVEN_STATE_ROOT or ~/.redeven)")
	modeRaw := fs.String("mode", "remote", "Run mode: remote|hybrid|local|desktop")
	localUIBindRaw := fs.String("local-ui-bind", localui.DefaultBind, "Local UI bind address (default: localhost:23998)")
	password := fs.String("password", "", "Access password (not recommended; prefer --password-env or --password-file)")
	passwordStdin := fs.Bool("password-stdin", false, "Read the access password from stdin")
	passwordEnv := fs.String("password-env", "", "Environment variable name holding the access password")
	passwordFile := fs.String("password-file", "", "File path holding the access password")
	desktopManaged := fs.Bool("desktop-managed", false, "Disable CLI self-upgrade semantics for desktop-managed Local UI runs")
	startupReportFile := fs.String("startup-report-file", "", "Write Local UI readiness JSON to the given file (advanced)")
	presentationRaw := fs.String("presentation", string(runtimepresentation.ModeAuto), "Startup presentation: auto|rich|plain|machine")
	var desktopLaunchFailure func(string, string, config.StateLayout, int) int

	if err := parseCommandFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			writeText(c.stdout, runHelpText())
			return 0
		}
		message, details := translateFlagParseError("run", err)
		writeErrorWithHelp(c.stderr, message, details, runHelpText())
		return 2
	}

	requestedPresentation, err := runtimepresentation.ParseMode(*presentationRaw)
	if err != nil {
		writeErrorWithHelp(
			c.stderr,
			fmt.Sprintf("invalid value for `--presentation`: %s", strings.TrimSpace(*presentationRaw)),
			[]string{
				"Allowed values: auto, rich, plain, machine.",
				"Example: redeven run --mode hybrid --presentation rich",
			},
			runHelpText(),
		)
		return 2
	}

	mode, err := parseRunMode(*modeRaw)
	if err != nil {
		writeErrorWithHelp(
			c.stderr,
			fmt.Sprintf("invalid value for `--mode`: %s", strings.TrimSpace(*modeRaw)),
			[]string{
				"Allowed values: remote, hybrid, local, desktop.",
				"Example: redeven run --mode hybrid",
			},
			runHelpText(),
		)
		return 2
	}

	localUIBind, err := localui.ParseBind(*localUIBindRaw)
	if err != nil {
		writeErrorWithHelp(
			c.stderr,
			fmt.Sprintf("invalid value for `--local-ui-bind`: %v", err),
			[]string{"Accepted examples: localhost:23998, 127.0.0.1:24000, 127.0.0.1:0, 0.0.0.0:24000, 192.168.1.11:24000"},
			runHelpText(),
		)
		return 2
	}

	resolvedBootstrapTicket, err := resolveBootstrapTicket(bootstrapTicketOptions{
		ticket:    *bootstrapTicket,
		ticketEnv: *bootstrapTicketEnv,
	})
	if err != nil {
		message, details := translateBootstrapTicketOptionError(err, "redeven run")
		writeErrorWithHelp(c.stderr, message, details, runHelpText())
		return 2
	}

	if *desktopManaged && mode == runModeRemote {
		writeErrorWithHelp(
			c.stderr,
			"`--desktop-managed` requires a Local UI run mode",
			[]string{"Hint: use `redeven run --mode desktop --desktop-managed --presentation machine` for the packaged desktop shell."},
			runHelpText(),
		)
		return 2
	}
	if strings.TrimSpace(*startupReportFile) != "" && mode == runModeRemote {
		writeErrorWithHelp(
			c.stderr,
			"`--startup-report-file` requires a Local UI run mode",
			[]string{"Hint: use `redeven run --mode desktop --presentation machine --startup-report-file <path>` when a desktop shell needs machine-readable readiness output."},
			runHelpText(),
		)
		return 2
	}
	if (*desktopManaged || strings.TrimSpace(*startupReportFile) != "") &&
		requestedPresentation != runtimepresentation.ModeAuto &&
		requestedPresentation != runtimepresentation.ModeMachine {
		writeErrorWithHelp(
			c.stderr,
			"`--desktop-managed` and `--startup-report-file` require `--presentation machine`",
			[]string{"Hint: Desktop and startup-report consumers must use the machine presentation contract."},
			runHelpText(),
		)
		return 2
	}

	presentationConfig := runtimepresentation.ResolveConfig(requestedPresentation, runtimepresentation.ResolveInput{
		Stdin:             c.stdin,
		Stdout:            c.stdout,
		Stderr:            c.stderr,
		DesktopManaged:    *desktopManaged,
		StartupReportFile: *startupReportFile,
	})

	stateLayout, err := resolveRunStateLayout(*stateRoot)
	if err != nil {
		return c.printRunStateLayoutGuidance(err)
	}
	presentationSnapshot := runtimepresentation.Snapshot{
		Version:          Version,
		Commit:           Commit,
		RequestedRunMode: string(mode),
		PresentationMode: string(presentationConfig.Effective),
		DesktopManaged:   *desktopManaged,
		StateDir:         stateLayout.StateDir,
		LocalUIBind:      localUIBind.ListenLabel(),
	}
	logBuffer := runtimepresentation.NewLogBuffer(500)
	presentationRenderer := runtimepresentation.NewRendererWithOptions(c.stderr, presentationConfig, runtimepresentation.RendererOptions{
		Input: c.stdin,
		Logs:  logBuffer,
	})
	startupReporter := runtimepresentation.NewReporter(
		presentationSnapshot,
		presentationRenderer,
	)
	_ = startupReporter.Start()
	_ = startupReporter.Emit(runtimepresentation.Event{
		Kind:  runtimepresentation.EventPhaseDone,
		Phase: runtimepresentation.PhaseResolveState,
		Title: fmt.Sprintf("local state: %s", stateLayout.StateDir),
	})
	if desktopLaunchReportEnabled(mode, *desktopManaged, *startupReportFile) {
		desktopLaunchFailure = func(code string, message string, layout config.StateLayout, exitCode int) int {
			if reportErr := writeDesktopBlockedLaunchReport(*startupReportFile, code, message, layout); reportErr != nil {
				fmt.Fprintf(c.stderr, "failed to write desktop launch report: %v\n", reportErr)
				return 1
			}
			fmt.Fprintf(c.stderr, "%s\n", message)
			return exitCode
		}
	}
	failRuntimeLaunch := func(code string, message string, exitCode int, remediation string) int {
		if remediation == "" {
			remediation = remediationForStartupFailure(code)
		}
		if presentationConfig.Effective != runtimepresentation.ModeMachine {
			_ = startupReporter.Emit(runtimepresentation.Event{
				Kind:        runtimepresentation.EventFailure,
				Phase:       runtimepresentation.PhaseShutdown,
				Title:       message,
				ErrorCode:   code,
				Severity:    runtimepresentation.SeverityError,
				Remediation: remediation,
			})
			_ = startupReporter.Close(runtimepresentation.Result{Success: false, Error: errors.New(message)})
		}
		if desktopLaunchFailure != nil {
			return desktopLaunchFailure(code, message, stateLayout, exitCode)
		}
		if presentationConfig.Effective == runtimepresentation.ModeMachine {
			fmt.Fprintf(c.stderr, "%s\n", message)
		}
		return exitCode
	}
	failDesktopLaunch := func(code string, message string) int {
		return failRuntimeLaunch(code, message, 1, "")
	}

	bootstrapViaFlags := strings.TrimSpace(*providerOrigin) != "" ||
		strings.TrimSpace(*controlplane) != "" ||
		strings.TrimSpace(*envID) != "" ||
		resolvedBootstrapTicket != ""
	if bootstrapViaFlags {
		missing := findMissingFlags(
			requiredFlag{name: "--provider-origin", value: *providerOrigin},
			requiredFlag{name: "--controlplane", value: *controlplane},
			requiredFlag{name: "--env-id", value: *envID},
			requiredFlag{name: "one bootstrap ticket (--bootstrap-ticket or --bootstrap-ticket-env)", value: resolvedBootstrapTicket},
		)
		if len(missing) > 0 {
			label := "flags"
			if len(missing) == 1 {
				label = "flag"
			}
			message := fmt.Sprintf("incomplete bootstrap flags for `redeven run`: missing %s %s", label, formatFlagList(missing))
			writeErrorWithHelp(
				c.stderr,
				message,
				[]string{
					"Hint: provide --provider-origin, --controlplane, --env-id, and exactly one bootstrap ticket together, or run `redeven bootstrap` first.",
					fmt.Sprintf(
						"Example: redeven run --mode hybrid --provider-origin %s --controlplane %s --env-id %s --bootstrap-ticket %s",
						exampleProviderOrigin,
						exampleControlplaneURL,
						exampleEnvID,
						exampleBootstrapTicket,
					),
					fmt.Sprintf(
						"Example: %s=%s redeven run --mode desktop --desktop-managed --presentation machine --provider-origin %s --controlplane %s --env-id %s --bootstrap-ticket-env %s",
						exampleBootstrapEnv,
						exampleBootstrapTicket,
						exampleProviderOrigin,
						exampleControlplaneURL,
						exampleEnvID,
						exampleBootstrapEnv,
					),
				},
				runHelpText(),
			)
			if desktopLaunchFailure != nil {
				return desktopLaunchFailure(desktopLaunchCodeStartupInvalid, message, stateLayout, 2)
			}
			return 2
		}
	}

	// Ensure the state/config directory exists before taking the lock.
	// Local mode must work on a clean Local Environment (no bootstrap yet).
	_ = startupReporter.Emit(runtimepresentation.Event{
		Kind:  runtimepresentation.EventPhaseStarted,
		Phase: runtimepresentation.PhaseResolveState,
		Title: "Preparing local state",
	})
	if err := os.MkdirAll(stateLayout.StateDir, 0o700); err != nil {
		return failDesktopLaunch(desktopLaunchCodeStartupFailed, fmt.Sprintf("failed to init state dir: %v", err))
	}

	// Prevent multiple runtime processes from managing the same local state directory.
	// This avoids control-plane flapping and data-plane races when users start the runtime twice.
	runtimeInstanceID, err := newRuntimeInstanceID()
	if err != nil {
		return failDesktopLaunch(desktopLaunchCodeStartupFailed, fmt.Sprintf("failed to create runtime instance id: %v", err))
	}
	lockPath := filepath.Join(stateLayout.StateDir, "agent.lock")
	_ = startupReporter.Emit(runtimepresentation.Event{
		Kind:  runtimepresentation.EventPhaseStarted,
		Phase: runtimepresentation.PhaseAcquireLock,
		Title: "Acquiring runtime lock",
	})
	lk, err := lockfile.Acquire(lockPath)
	if err != nil {
		if errors.Is(err, lockfile.ErrAlreadyLocked) {
			if desktopLaunchReportEnabled(mode, *desktopManaged, *startupReportFile) {
				handled, exitCode, reportErr := handleDesktopLockConflict(*startupReportFile, lockPath, stateLayout.ConfigPath)
				if reportErr != nil {
					fmt.Fprintf(c.stderr, "failed to resolve desktop startup conflict: %v\n", reportErr)
					return 1
				}
				if handled {
					return exitCode
				}
			}
			return failDesktopLaunch(
				desktopLaunchCodeStateDirLocked,
				fmt.Sprintf("another redeven runtime instance is already using this state directory: %s", lockPath),
			)
		}
		return failDesktopLaunch(desktopLaunchCodeStartupFailed, fmt.Sprintf("failed to acquire runtime lock (%s): %v", lockPath, err))
	}
	defer func() { _ = lk.Release() }()
	_ = startupReporter.Emit(runtimepresentation.Event{
		Kind:   runtimepresentation.EventPhaseDone,
		Phase:  runtimepresentation.PhaseAcquireLock,
		Title:  "runtime lock acquired",
		Detail: lockPath,
	})

	runPassword, err := resolveRunPassword(runPasswordOptions{
		password:      *password,
		passwordStdin: *passwordStdin,
		passwordEnv:   *passwordEnv,
		passwordFile:  *passwordFile,
		stdin:         c.stdin,
	})
	if err != nil {
		message, details := translatePasswordOptionError(err)
		writeErrorWithHelp(c.stderr, message, details, runHelpText())
		return 2
	}

	accessGate := newAccessGate(runPassword.password)
	if err := verifyStartupAccessPassword(accessGate, runPassword.requireStartupVerification); err != nil {
		message, details := translatePasswordVerificationError(err)
		writeErrorWithHelp(c.stderr, message, details, "")
		if desktopLaunchFailure != nil {
			return desktopLaunchFailure(desktopLaunchCodeStartupInvalid, message, stateLayout, 1)
		}
		return 1
	}
	if mode != runModeRemote && !localUIBind.IsLoopbackOnly() && !accessGate.Enabled() {
		writeErrorWithHelp(
			c.stderr,
			"non-loopback `--local-ui-bind` requires an access password",
			[]string{
				"Hint: set exactly one of --password, --password-stdin, --password-env, or --password-file.",
				fmt.Sprintf(
					"Example: %s=replace-with-a-long-password redeven run --mode hybrid --local-ui-bind 0.0.0.0:24000 --password-env %s",
					examplePasswordEnv,
					examplePasswordEnv,
				),
			},
			runHelpText(),
		)
		return 2
	}

	if bootstrapViaFlags {
		_ = startupReporter.Emit(runtimepresentation.Event{
			Kind:  runtimepresentation.EventPhaseStarted,
			Phase: runtimepresentation.PhaseBootstrap,
			Title: "Bootstrapping provider binding",
		})
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()

		_, err = config.BootstrapConfig(ctx, buildRunBootstrapArgs(
			stateLayout.StateRoot,
			*providerOrigin,
			*controlplane,
			*envID,
			resolvedBootstrapTicket,
			*permissionPolicy,
			mode,
			*desktopManaged,
			Version,
		))
		if err != nil {
			return failDesktopLaunch(desktopLaunchCodeStartupFailed, fmt.Sprintf("bootstrap failed: %v", err))
		}
		_ = startupReporter.Emit(runtimepresentation.Event{
			Kind:  runtimepresentation.EventPhaseDone,
			Phase: runtimepresentation.PhaseBootstrap,
			Title: "provider binding saved",
		})
	}

	_ = startupReporter.Emit(runtimepresentation.Event{
		Kind:  runtimepresentation.EventPhaseStarted,
		Phase: runtimepresentation.PhaseLoadConfig,
		Title: "Loading runtime config",
	})
	cfg, err := config.Load(stateLayout.ConfigPath)
	if err != nil {
		// Local mode must be able to start from a clean Local Environment (no bootstrap yet).
		if (mode == runModeLocal || mode == runModeDesktop) && os.IsNotExist(err) {
			p, _ := config.ParsePermissionPolicyPreset("")
			cfg = &config.Config{
				PermissionPolicy: p,
				LogFormat:        "json",
				LogLevel:         "info",
			}
			if err := config.Save(stateLayout.ConfigPath, cfg); err != nil {
				return failDesktopLaunch(desktopLaunchCodeStartupFailed, fmt.Sprintf("failed to init default config: %v", err))
			}
		} else if os.IsNotExist(err) {
			return c.printNotBootstrappedGuidance(err)
		} else {
			return failDesktopLaunch(desktopLaunchCodeStartupFailed, fmt.Sprintf("failed to load config: %v", err))
		}
	}
	_ = startupReporter.Emit(runtimepresentation.Event{
		Kind:  runtimepresentation.EventPhaseDone,
		Phase: runtimepresentation.PhaseLoadConfig,
		Title: "runtime config loaded",
	})
	remoteErr := cfg.ValidateRemoteStrict()
	remoteEnabled := remoteErr == nil

	launchPolicy := resolveRuntimeLaunchPolicy(mode, *desktopManaged, remoteEnabled)
	controlChannelEnabled := launchPolicy.controlChannelEnabled
	localUIEnabled := launchPolicy.localUIEnabled
	effectiveRunMode := launchPolicy.effectiveRunMode
	processRemoteEnabled := launchPolicy.remoteEnabled
	startupReporter.UpdateSnapshot(func(snapshot *runtimepresentation.Snapshot) {
		snapshot.EffectiveRunMode = string(effectiveRunMode)
		snapshot.RemoteEnabled = processRemoteEnabled
		snapshot.ControlChannelEnabled = controlChannelEnabled
		snapshot.LocalUIEnabled = localUIEnabled
		snapshot.ProviderOrigin = cfg.ProviderOrigin
		snapshot.ControlplaneBaseURL = cfg.ControlplaneBaseURL
		snapshot.ControlplaneProviderID = cfg.ControlplaneProviderID
		snapshot.EnvPublicID = cfg.EnvironmentID
		snapshot.RuntimeControlSocketPath = stateLayout.RuntimeControlSocketPath
		snapshot.EnvironmentURL = runtimepresentation.BuildEnvironmentURL(cfg.ControlplaneBaseURL, cfg.EnvironmentID)
	})

	if controlChannelEnabled && !remoteEnabled {
		message := fmt.Sprintf("runtime is not bootstrapped for remote or hybrid mode: %v", remoteErr)
		if desktopLaunchFailure != nil {
			return desktopLaunchFailure(desktopLaunchCodeStartupInvalid, message, stateLayout, 1)
		}
		return c.printNotBootstrappedGuidance(remoteErr)
	}

	localUIBindLabel := localUIBind.ListenLabel()
	localUIURLs := localUIBind.DisplayURLs()
	desktopOwnerID := ""
	if *desktopManaged {
		desktopOwnerID = strings.TrimSpace(os.Getenv(desktopOwnerIDEnvName))
	}
	if err := writeAgentLockMetadata(lk, newAgentLockMetadata(string(mode), runtimeInstanceID, *desktopManaged, desktopOwnerID, mode != runModeRemote, stateLayout)); err != nil {
		return failDesktopLaunch(desktopLaunchCodeStartupFailed, fmt.Sprintf("failed to write runtime lock metadata: %v", err))
	}
	if err := config.WriteEnvironmentCatalogRecord(stateLayout, cfg, localUIBindLabel, accessGate.Enabled()); err != nil {
		return failDesktopLaunch(desktopLaunchCodeStartupFailed, fmt.Sprintf("failed to update environment catalog: %v", err))
	}
	announce := func() {
		startupReporter.UpdateSnapshot(func(snapshot *runtimepresentation.Snapshot) {
			snapshot.LocalUIBind = localUIBindLabel
			snapshot.LocalUIURLs = append([]string(nil), localUIURLs...)
			snapshot.EnvironmentURL = runtimepresentation.BuildEnvironmentURL(cfg.ControlplaneBaseURL, cfg.EnvironmentID)
		})
		_ = startupReporter.Emit(runtimepresentation.Event{
			Kind:     runtimepresentation.EventReady,
			Phase:    runtimepresentation.PhaseReady,
			Title:    "Redeven runtime is ready",
			Snapshot: startupReporter.Snapshot(),
		})
	}
	logOutput, closeLogOutput := runtimeLogOutput(stateLayout.StateDir, presentationConfig, c.stderr, logBuffer)
	defer closeLogOutput()
	localUILogger := slog.New(slog.NewTextHandler(logOutput, &slog.HandlerOptions{Level: slog.LevelInfo}))

	a, err := agent.New(agent.Options{
		Config:                cfg,
		ConfigPath:            stateLayout.ConfigPath,
		StateRoot:             stateLayout.StateRoot,
		InstanceID:            runtimeInstanceID,
		LocalUIBind:           localUIBind.ListenLabel(),
		LocalUIEnabled:        localUIEnabled,
		ControlChannelEnabled: controlChannelEnabled,
		DesktopManaged:        *desktopManaged,
		EffectiveRunMode:      string(effectiveRunMode),
		RemoteEnabled:         processRemoteEnabled,
		Version:               Version,
		Commit:                Commit,
		BuildTime:             BuildTime,
		LogOutput:             logOutput,
		OnControlConnected:    announce,
		OnControlConnecting: func() {
			_ = startupReporter.Emit(runtimepresentation.Event{
				Kind:   runtimepresentation.EventPhaseStarted,
				Phase:  runtimepresentation.PhaseConnectControl,
				Title:  "Connecting control plane",
				Detail: cfg.ControlplaneBaseURL,
			})
		},
		OnControlRetry: func(err error, delay time.Duration) {
			_ = startupReporter.Emit(runtimepresentation.Event{
				Kind:        runtimepresentation.EventWarning,
				Phase:       runtimepresentation.PhaseConnectControl,
				Title:       "Control plane is temporarily unreachable.",
				Detail:      "Redeven will keep retrying; Local UI remains available.",
				Severity:    runtimepresentation.SeverityWarning,
				Remediation: fmt.Sprintf("Next retry in %s.", delay.Round(time.Second)),
			})
		},
		OnControlDisabled: func() {
			if localUIEnabled {
				return
			}
			_ = startupReporter.Emit(runtimepresentation.Event{
				Kind:  runtimepresentation.EventPhaseDone,
				Phase: runtimepresentation.PhaseConnectControl,
				Title: "control channel disabled",
			})
		},
		AccessGate: accessGate,
	})
	if err != nil {
		return failDesktopLaunch(desktopLaunchCodeStartupFailed, fmt.Sprintf("failed to init runtime: %v", err))
	}
	presentationRenderer.SetController(&runtimePresentationController{agent: a})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Graceful shutdown on SIGINT/SIGTERM.
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-stop
		cancel()
	}()

	// Start the Local UI server before running the control channel loop so users can open
	// the local page immediately.
	if localUIEnabled {
		_ = startupReporter.Emit(runtimepresentation.Event{
			Kind:  runtimepresentation.EventPhaseStarted,
			Phase: runtimepresentation.PhaseStartLocalUI,
			Title: "Starting Local UI",
		})
		gw := a.CodeGateway()
		if gw == nil {
			return failDesktopLaunch(desktopLaunchCodeStartupFailed, "local ui unavailable: gateway not initialized")
		}

		srv, err := localui.New(localui.Options{
			Logger:                   localUILogger,
			Bind:                     localUIBind,
			DesktopManaged:           *desktopManaged,
			DesktopOwnerID:           desktopOwnerID,
			EffectiveRunMode:         string(effectiveRunMode),
			RemoteEnabled:            processRemoteEnabled,
			ControlplaneBaseURL:      cfg.ControlplaneBaseURL,
			ControlplaneProviderID:   cfg.ControlplaneProviderID,
			EnvPublicID:              cfg.EnvironmentID,
			Gateway:                  gw,
			Agent:                    a,
			ConfigPath:               stateLayout.ConfigPath,
			StateRoot:                stateLayout.StateRoot,
			RuntimeControlSocketPath: stateLayout.RuntimeControlSocketPath,
			Version:                  Version,
			Diagnostics:              a.DiagnosticsStore(),
			AccessGate:               accessGate,
		})
		if err != nil {
			return failDesktopLaunch(desktopLaunchCodeStartupFailed, fmt.Sprintf("failed to init local ui: %v", err))
		}
		if err := srv.Start(ctx); err != nil {
			return failRuntimeLaunch(
				desktopLaunchCodeStartupFailed,
				fmt.Sprintf("failed to start local ui: %v", err),
				1,
				"Start Redeven on another local port, for example: redeven run --mode hybrid --local-ui-bind 127.0.0.1:24000",
			)
		}
		localUIBindLabel = srv.ListenLabel()
		localUIURLs = srv.DisplayURLs()
		a.SetLocalUIBind(localUIBindLabel)
		startupReporter.UpdateSnapshot(func(snapshot *runtimepresentation.Snapshot) {
			snapshot.LocalUIBind = localUIBindLabel
			snapshot.LocalUIURLs = append([]string(nil), localUIURLs...)
		})
		_ = startupReporter.Emit(runtimepresentation.Event{
			Kind:   runtimepresentation.EventPhaseDone,
			Phase:  runtimepresentation.PhaseStartLocalUI,
			Title:  "Local UI ready",
			Detail: firstNonEmptyString(localUIURLs),
		})
		if err := config.WriteEnvironmentCatalogRecord(stateLayout, cfg, localUIBindLabel, accessGate.Enabled()); err != nil {
			return failDesktopLaunch(desktopLaunchCodeStartupFailed, fmt.Sprintf("failed to refresh environment catalog: %v", err))
		}
		if reportPath := strings.TrimSpace(*startupReportFile); reportPath != "" {
			if err := writeDesktopReadyLaunchReport(reportPath, runtimeStartupReport{
				LocalUIURL:  firstNonEmptyString(localUIURLs),
				LocalUIURLs: append([]string(nil), localUIURLs...),
				RuntimeControl: func() *runtimeControlEndpoint {
					endpoint := srv.RuntimeControlEndpointForDesktopBridge()
					if endpoint == nil {
						return nil
					}
					return &runtimeControlEndpoint{
						ProtocolVersion: endpoint.ProtocolVersion,
						BaseURL:         endpoint.BaseURL,
						Token:           endpoint.Token,
						DesktopOwnerID:  endpoint.DesktopOwnerID,
						ExpiresAtUnixMS: endpoint.ExpiresAtUnixMS,
					}
				}(),
				PasswordRequired:         accessGate != nil && accessGate.Enabled(),
				EffectiveRunMode:         string(effectiveRunMode),
				RemoteEnabled:            processRemoteEnabled,
				DesktopManaged:           *desktopManaged,
				DesktopOwnerID:           desktopOwnerID,
				ProviderOrigin:           cfg.ProviderOrigin,
				ControlplaneBaseURL:      cfg.ControlplaneBaseURL,
				ControlplaneProviderID:   cfg.ControlplaneProviderID,
				EnvPublicID:              cfg.EnvironmentID,
				StateDir:                 stateLayout.StateDir,
				RuntimeControlSocketPath: stateLayout.RuntimeControlSocketPath,
				DiagnosticsEnabled:       a.DiagnosticsEnabled(),
				PID:                      os.Getpid(),
				StartedAtUnixMS:          a.ProcessStartedAtUnixMS(),
				RuntimeService:           a.RuntimeServiceSnapshot(),
			}, desktopLaunchStatusReady); err != nil {
				fmt.Fprintf(c.stderr, "failed to write desktop launch report: %v\n", err)
				return 1
			}
		}

		// In local-only modes, print after the Local UI is ready.
		// In remote-connected modes, print after the control channel connects so the
		// final environment URL and Local UI URL are both available together.
		if !controlChannelEnabled {
			_ = startupReporter.Emit(runtimepresentation.Event{
				Kind:  runtimepresentation.EventPhaseDone,
				Phase: runtimepresentation.PhaseConnectControl,
				Title: "control channel disabled",
			})
			announce()
		}
	}

	if err := a.Run(ctx); err != nil && ctx.Err() == nil {
		return failDesktopLaunch(desktopLaunchCodeStartupFailed, fmt.Sprintf("runtime exited with error: %v", err))
	}
	_ = startupReporter.Close(runtimepresentation.Result{Success: true, Snapshot: startupReporter.Snapshot()})
	return 0
}

func resolveBootstrapTargetLayout(
	stateRoot string,
) (config.StateLayout, error) {
	return config.LocalEnvironmentStateLayout(stateRoot)
}

func resolveRunStateLayout(
	stateRoot string,
) (config.StateLayout, error) {
	return config.LocalEnvironmentStateLayout(stateRoot)
}

func (c *cli) printRunStateLayoutGuidance(reason error) int {
	if errors.Is(reason, config.ErrHomeDirUnavailable) {
		writeErrorWithHelp(
			c.stderr,
			fmt.Sprintf("failed to resolve runtime state layout: %v", reason),
			[]string{"Hint: export HOME before running `redeven run`, or pass --state-root <path>."},
			runHelpText(),
		)
		return 1
	}
	fmt.Fprintf(c.stderr, "failed to resolve runtime state layout: %v\n", reason)
	return 1
}

func buildRunBootstrapArgs(
	stateRoot string,
	providerOrigin string,
	controlplane string,
	envID string,
	bootstrapTicket string,
	permissionPolicy string,
	mode runMode,
	desktopManaged bool,
	runtimeVersion string,
) config.BootstrapArgs {
	args := config.BootstrapArgs{
		ProviderOrigin:         providerOrigin,
		ControlplaneBaseURL:    controlplane,
		EnvironmentID:          envID,
		BootstrapTicket:        bootstrapTicket,
		RuntimeVersion:         runtimeVersion,
		StateRoot:              stateRoot,
		PermissionPolicyPreset: permissionPolicy,
	}
	if mode == runModeDesktop && desktopManaged {
		// Desktop startup should stay on the normal logging baseline unless the
		// user later opts into debug mode explicitly from Runtime Settings.
		args.LogLevel = "info"
	}
	return args
}

func runtimeLogOutput(stateDir string, presentation runtimepresentation.Config, fallback io.Writer, extra ...io.Writer) (io.Writer, func()) {
	writers := make([]io.Writer, 0, 2+len(extra))
	for _, writer := range extra {
		if writer != nil {
			writers = append(writers, writer)
		}
	}
	if presentation.Effective == runtimepresentation.ModeMachine {
		if len(writers) == 0 {
			return fallback, func() {}
		}
		return io.MultiWriter(append([]io.Writer{fallback}, writers...)...), func() {}
	}
	if strings.TrimSpace(stateDir) == "" {
		if len(writers) == 0 {
			return fallback, func() {}
		}
		return io.MultiWriter(append([]io.Writer{fallback}, writers...)...), func() {}
	}
	logPath := filepath.Join(stateDir, "runtime.log")
	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		if len(writers) == 0 {
			return fallback, func() {}
		}
		return io.MultiWriter(append([]io.Writer{fallback}, writers...)...), func() {}
	}
	writers = append([]io.Writer{f}, writers...)
	return io.MultiWriter(writers...), func() { _ = f.Close() }
}

func remediationForStartupFailure(code string) string {
	switch code {
	case desktopLaunchCodeStateDirLocked:
		return "Stop the existing Redeven runtime for this state directory, or start with a different --state-root."
	case desktopLaunchCodeStartupInvalid:
		return "Check the startup flags and run `redeven help run` for the supported startup shapes."
	case desktopLaunchCodeStartupFailed:
		return "Check the diagnostics log in the Local Environment state directory."
	default:
		return ""
	}
}

func (c *cli) printNotBootstrappedGuidance(reason error) int {
	writeErrorWithHelp(
		c.stderr,
		fmt.Sprintf("runtime is not bootstrapped for remote or hybrid mode: %v", reason),
		[]string{
			"Hint: run `redeven bootstrap` first, or pass --provider-origin, --controlplane, --env-id, and a one-time bootstrap ticket directly to `redeven run`.",
			"Examples:",
			fmt.Sprintf("  redeven bootstrap --provider-origin %s --controlplane %s --env-id %s --bootstrap-ticket %s", exampleProviderOrigin, exampleControlplaneURL, exampleEnvID, exampleBootstrapTicket),
			fmt.Sprintf("  redeven run --mode hybrid --provider-origin %s --controlplane %s --env-id %s --bootstrap-ticket %s", exampleProviderOrigin, exampleControlplaneURL, exampleEnvID, exampleBootstrapTicket),
			fmt.Sprintf("  %s=%s redeven run --mode desktop --desktop-managed --presentation machine --provider-origin %s --controlplane %s --env-id %s --bootstrap-ticket-env %s", exampleBootstrapEnv, exampleBootstrapTicket, exampleProviderOrigin, exampleControlplaneURL, exampleEnvID, exampleBootstrapEnv),
		},
		"",
	)
	return 1
}

type runMode string

const (
	runModeRemote  runMode = "remote"
	runModeHybrid  runMode = "hybrid"
	runModeLocal   runMode = "local"
	runModeDesktop runMode = "desktop"
)

type runtimeLaunchPolicy struct {
	localUIEnabled        bool
	controlChannelEnabled bool
	effectiveRunMode      runMode
	remoteEnabled         bool
}

func resolveRuntimeLaunchPolicy(mode runMode, desktopManaged bool, remoteConfigValid bool) runtimeLaunchPolicy {
	switch mode {
	case runModeRemote:
		return runtimeLaunchPolicy{
			localUIEnabled:        false,
			controlChannelEnabled: true,
			effectiveRunMode:      runModeRemote,
			remoteEnabled:         true,
		}
	case runModeHybrid:
		return runtimeLaunchPolicy{
			localUIEnabled:        true,
			controlChannelEnabled: true,
			effectiveRunMode:      runModeHybrid,
			remoteEnabled:         true,
		}
	case runModeLocal:
		return runtimeLaunchPolicy{
			localUIEnabled:        true,
			controlChannelEnabled: false,
			effectiveRunMode:      runModeLocal,
			remoteEnabled:         false,
		}
	case runModeDesktop:
		if remoteConfigValid {
			// IMPORTANT: A saved provider link is an explicit user authorization.
			// Desktop-managed startup must restore that provider control channel;
			// provider cards still never initiate runtime management.
			return runtimeLaunchPolicy{
				localUIEnabled:        true,
				controlChannelEnabled: true,
				effectiveRunMode:      runModeHybrid,
				remoteEnabled:         true,
			}
		}
		return runtimeLaunchPolicy{
			localUIEnabled:        true,
			controlChannelEnabled: false,
			effectiveRunMode:      runModeLocal,
			remoteEnabled:         false,
		}
	default:
		return runtimeLaunchPolicy{
			localUIEnabled:        mode != runModeRemote,
			controlChannelEnabled: false,
			effectiveRunMode:      mode,
			remoteEnabled:         false,
		}
	}
}

func parseRunMode(raw string) (runMode, error) {
	v := strings.ToLower(strings.TrimSpace(raw))
	switch v {
	case string(runModeRemote):
		return runModeRemote, nil
	case string(runModeHybrid):
		return runModeHybrid, nil
	case string(runModeLocal):
		return runModeLocal, nil
	case string(runModeDesktop):
		return runModeDesktop, nil
	default:
		return "", fmt.Errorf("want remote|hybrid|local|desktop, got %q", raw)
	}
}
