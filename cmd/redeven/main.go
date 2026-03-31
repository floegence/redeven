package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/floegence/redeven/internal/agent"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/localui"
	localuiruntime "github.com/floegence/redeven/internal/localui/runtime"
	"github.com/floegence/redeven/internal/lockfile"
)

var (
	// Version is set via -ldflags at build time.
	Version = "dev"
	// Commit is set via -ldflags at build time.
	Commit = "unknown"
	// BuildTime is set via -ldflags at build time.
	BuildTime = "unknown"
)

type cli struct {
	stdout io.Writer
	stderr io.Writer
}

func main() {
	os.Exit(runCLI(os.Args[1:], os.Stdout, os.Stderr))
}

func runCLI(args []string, stdout, stderr io.Writer) int {
	cleanupLegacyHomeDir()
	return (&cli{stdout: stdout, stderr: stderr}).run(args)
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
	case "search":
		return c.searchCmd(args[1:])
	case "knowledge":
		return c.knowledgeCmd(args[1:])
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

func cleanupLegacyHomeDir() {
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return
	}

	// NOTE: We renamed the default config/state directory from ~/.redeven-agent to ~/.redeven.
	// During development, remove the legacy directory proactively to avoid stale state surprises.
	_ = os.RemoveAll(filepath.Join(home, ".redeven-agent"))
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

	controlplane := fs.String("controlplane", "", "Controlplane base URL (e.g. https://region.example.invalid)")
	envID := fs.String("env-id", "", "Environment public ID (env_...)")
	envToken := fs.String("env-token", "", "Environment token (raw token; 'Bearer <token>' is also accepted)")
	envTokenEnv := fs.String("env-token-env", "", "Environment variable name holding the environment token")

	agentHomeDir := fs.String("agent-home-dir", "", "Agent home dir used for filesystem-facing features (default: user home dir)")
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

	resolvedEnvToken, err := resolveEnvToken(envTokenOptions{
		token:    *envToken,
		tokenEnv: *envTokenEnv,
	})
	if err != nil {
		message, details := translateEnvTokenOptionError(err, "redeven bootstrap")
		writeErrorWithHelp(c.stderr, message, details, bootstrapHelpText())
		return 2
	}

	missing := findMissingFlags(
		requiredFlag{name: "--controlplane", value: *controlplane},
		requiredFlag{name: "--env-id", value: *envID},
		requiredFlag{name: "one of --env-token or --env-token-env", value: resolvedEnvToken},
	)
	if len(missing) > 0 {
		writeErrorWithHelp(
			c.stderr,
			fmt.Sprintf("missing required flags for `redeven bootstrap`: %s", formatFlagList(missing)),
			[]string{
				fmt.Sprintf(
					"Example: redeven bootstrap --controlplane %s --env-id %s --env-token %s",
					exampleControlplaneURL,
					exampleEnvID,
					exampleEnvToken,
				),
			},
			bootstrapHelpText(),
		)
		return 2
	}

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()

	_, err = config.BootstrapConfig(ctx, config.BootstrapArgs{
		ControlplaneBaseURL:    *controlplane,
		EnvironmentID:          *envID,
		EnvironmentToken:       resolvedEnvToken,
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

	fmt.Fprintf(c.stdout, "Bootstrap complete. Run `redeven run`.\n")
	return 0
}

func (c *cli) runCmd(args []string) int {
	fs := newCLIFlagSet("run")
	controlplane := fs.String("controlplane", "", "Controlplane base URL (optional; when set, bootstraps into an isolated per-environment state dir)")
	envID := fs.String("env-id", "", "Environment public ID (env_...)")
	envToken := fs.String("env-token", "", "Environment token (required when --controlplane/--env-id is set)")
	envTokenEnv := fs.String("env-token-env", "", "Environment variable name holding the environment token")
	permissionPolicy := fs.String("permission-policy", "", "Local permission policy preset: execute_read|read_only|execute_read_write (optional; applies when bootstrapping)")
	modeRaw := fs.String("mode", "remote", "Run mode: remote|hybrid|local|desktop")
	localUIBindRaw := fs.String("local-ui-bind", localui.DefaultBind, "Local UI bind address (default: localhost:23998)")
	password := fs.String("password", "", "Access password (not recommended; prefer --password-env or --password-file)")
	passwordEnv := fs.String("password-env", "", "Environment variable name holding the access password")
	passwordFile := fs.String("password-file", "", "File path holding the access password")
	desktopManaged := fs.Bool("desktop-managed", false, "Disable CLI self-upgrade semantics for desktop-managed Local UI runs")
	startupReportFile := fs.String("startup-report-file", "", "Write Local UI readiness JSON to the given file (advanced)")

	if err := parseCommandFlags(fs, args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			writeText(c.stdout, runHelpText())
			return 0
		}
		message, details := translateFlagParseError("run", err)
		writeErrorWithHelp(c.stderr, message, details, runHelpText())
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

	resolvedEnvToken, err := resolveEnvToken(envTokenOptions{
		token:    *envToken,
		tokenEnv: *envTokenEnv,
	})
	if err != nil {
		message, details := translateEnvTokenOptionError(err, "redeven run")
		writeErrorWithHelp(c.stderr, message, details, runHelpText())
		return 2
	}

	if *desktopManaged && mode == runModeRemote {
		writeErrorWithHelp(
			c.stderr,
			"`--desktop-managed` requires a Local UI run mode",
			[]string{"Hint: use `redeven run --mode desktop --desktop-managed` for the packaged desktop shell."},
			runHelpText(),
		)
		return 2
	}
	if strings.TrimSpace(*startupReportFile) != "" && mode == runModeRemote {
		writeErrorWithHelp(
			c.stderr,
			"`--startup-report-file` requires a Local UI run mode",
			[]string{"Hint: use `redeven run --mode desktop --startup-report-file <path>` when a desktop shell needs machine-readable readiness output."},
			runHelpText(),
		)
		return 2
	}

	// Default: use the global config path. This is the recommended single-environment setup:
	//
	//	redeven bootstrap ... && redeven run
	cfgPathClean := filepath.Clean(config.DefaultConfigPath())

	// Multi-environment mode: bootstrap & run using an isolated state directory per env.
	// This avoids overwriting the global ~/.redeven/config.json.
	bootstrapViaFlags := strings.TrimSpace(*controlplane) != "" ||
		strings.TrimSpace(*envID) != "" ||
		resolvedEnvToken != ""
	if bootstrapViaFlags {
		missing := findMissingFlags(
			requiredFlag{name: "--controlplane", value: *controlplane},
			requiredFlag{name: "--env-id", value: *envID},
			requiredFlag{name: "one of --env-token or --env-token-env", value: resolvedEnvToken},
		)
		if len(missing) > 0 {
			label := "flags"
			if len(missing) == 1 {
				label = "flag"
			}
			writeErrorWithHelp(
				c.stderr,
				fmt.Sprintf("incomplete bootstrap flags for `redeven run`: missing %s %s", label, formatFlagList(missing)),
				[]string{
					"Hint: provide --controlplane, --env-id, and either --env-token or --env-token-env together, or run `redeven bootstrap` first.",
					fmt.Sprintf(
						"Example: redeven run --mode hybrid --controlplane %s --env-id %s --env-token %s",
						exampleControlplaneURL,
						exampleEnvID,
						exampleEnvToken,
					),
				},
				runHelpText(),
			)
			return 2
		}
		cfgPathClean = filepath.Clean(config.EnvConfigPath(*envID))
	}

	// Ensure the state/config directory exists before taking the lock.
	// Local mode must work on a clean machine (no bootstrap yet).
	cfgDir := filepath.Dir(cfgPathClean)
	if err := os.MkdirAll(cfgDir, 0o700); err != nil {
		fmt.Fprintf(c.stderr, "failed to init state dir: %v\n", err)
		return 1
	}

	// Prevent multiple agent processes from managing the same local state directory.
	// This avoids control-plane flapping and data-plane races when users start the agent twice.
	lockPath := filepath.Join(filepath.Dir(cfgPathClean), "agent.lock")
	lk, err := lockfile.Acquire(lockPath)
	if err != nil {
		if errors.Is(err, lockfile.ErrAlreadyLocked) {
			if desktopLaunchReportEnabled(mode, *desktopManaged, *startupReportFile) {
				handled, exitCode, reportErr := handleDesktopLockConflict(*startupReportFile, lockPath, cfgPathClean)
				if reportErr != nil {
					fmt.Fprintf(c.stderr, "failed to resolve desktop startup conflict: %v\n", reportErr)
					return 1
				}
				if handled {
					return exitCode
				}
			}
			fmt.Fprintf(c.stderr, "another redeven runtime instance is already using this state directory: %s\n", lockPath)
			fmt.Fprintf(c.stderr, "Hint: stop the existing agent process, or use a different environment/state directory before retrying.\n")
			return 1
		}
		fmt.Fprintf(c.stderr, "failed to acquire agent lock (%s): %v\n", lockPath, err)
		return 1
	}
	defer func() { _ = lk.Release() }()

	if err := writeAgentLockMetadata(lk, newAgentLockMetadata(string(mode), *desktopManaged, mode != runModeRemote, cfgPathClean, localuiruntime.RuntimeStatePath(cfgPathClean))); err != nil {
		fmt.Fprintf(c.stderr, "failed to write agent lock metadata: %v\n", err)
		return 1
	}

	runPassword, err := resolveRunPassword(runPasswordOptions{
		password:     *password,
		passwordEnv:  *passwordEnv,
		passwordFile: *passwordFile,
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
		return 1
	}
	if mode != runModeRemote && !localUIBind.IsLoopbackOnly() && !accessGate.Enabled() {
		writeErrorWithHelp(
			c.stderr,
			"non-loopback `--local-ui-bind` requires an access password",
			[]string{
				"Hint: set exactly one of --password, --password-env, or --password-file.",
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
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()

		_, err = config.BootstrapConfig(ctx, buildRunBootstrapArgs(
			cfgPathClean,
			*controlplane,
			*envID,
			resolvedEnvToken,
			*permissionPolicy,
			mode,
			*desktopManaged,
		))
		if err != nil {
			fmt.Fprintf(c.stderr, "bootstrap failed: %v\n", err)
			return 1
		}
	}

	cfg, err := config.Load(cfgPathClean)
	if err != nil {
		// Local mode must be able to start from a clean machine (no bootstrap yet).
		if (mode == runModeLocal || mode == runModeDesktop) && os.IsNotExist(err) {
			p, _ := config.ParsePermissionPolicyPreset("")
			cfg = &config.Config{
				PermissionPolicy: p,
				LogFormat:        "json",
				LogLevel:         "info",
			}
			if err := config.Save(cfgPathClean, cfg); err != nil {
				fmt.Fprintf(c.stderr, "failed to init default config: %v\n", err)
				return 1
			}
		} else if os.IsNotExist(err) {
			return c.printNotBootstrappedGuidance(err)
		} else {
			fmt.Fprintf(c.stderr, "failed to load config: %v\n", err)
			return 1
		}
	}

	remoteErr := cfg.ValidateRemoteStrict()
	remoteEnabled := remoteErr == nil

	controlChannelEnabled := mode == runModeRemote || mode == runModeHybrid || (mode == runModeDesktop && remoteEnabled)
	localUIEnabled := mode != runModeRemote
	effectiveRunMode := mode
	if mode == runModeDesktop {
		if controlChannelEnabled {
			effectiveRunMode = runModeHybrid
		} else {
			effectiveRunMode = runModeLocal
		}
	}

	if controlChannelEnabled && !remoteEnabled {
		return c.printNotBootstrappedGuidance(remoteErr)
	}

	localUIBindLabel := localUIBind.ListenLabel()
	localUIURLs := localUIBind.DisplayURLs()
	announce := func() {
		printWelcomeBanner(c.stderr, welcomeBannerOptions{
			Version:             Version,
			ControlplaneBaseURL: cfg.ControlplaneBaseURL,
			EnvironmentID:       cfg.EnvironmentID,
			LocalUIEnabled:      localUIEnabled,
			LocalUIBind:         localUIBindLabel,
			LocalUIURLs:         localUIURLs,
		})
	}

	a, err := agent.New(agent.Options{
		Config:                cfg,
		ConfigPath:            cfgPathClean,
		LocalUIEnabled:        localUIEnabled,
		ControlChannelEnabled: controlChannelEnabled,
		DesktopManaged:        *desktopManaged,
		EffectiveRunMode:      string(effectiveRunMode),
		RemoteEnabled:         controlChannelEnabled,
		Version:               Version,
		Commit:                Commit,
		BuildTime:             BuildTime,
		OnControlConnected:    announce,
		AccessGate:            accessGate,
	})
	if err != nil {
		fmt.Fprintf(c.stderr, "failed to init agent: %v\n", err)
		return 1
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if localUIEnabled {
		a.StartBackgroundServices(ctx)
	}

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
		cfgPathAbs, err := filepath.Abs(cfgPathClean)
		if err != nil {
			fmt.Fprintf(c.stderr, "failed to resolve config path: %v\n", err)
			return 1
		}
		gw := a.CodeGateway()
		if gw == nil {
			fmt.Fprintf(c.stderr, "local ui unavailable: gateway not initialized\n")
			return 1
		}

		srv, err := localui.New(localui.Options{
			Bind:             localUIBind,
			DesktopManaged:   *desktopManaged,
			EffectiveRunMode: string(effectiveRunMode),
			RemoteEnabled:    controlChannelEnabled,
			Gateway:          gw,
			Agent:            a,
			ConfigPath:       cfgPathAbs,
			Version:          Version,
			Diagnostics:      a.DiagnosticsStore(),
			AccessGate:       accessGate,
		})
		if err != nil {
			fmt.Fprintf(c.stderr, "failed to init local ui: %v\n", err)
			return 1
		}
		if err := srv.Start(ctx); err != nil {
			fmt.Fprintf(c.stderr, "failed to start local ui: %v\n", err)
			return 1
		}
		localUIBindLabel = srv.ListenLabel()
		localUIURLs = srv.DisplayURLs()
		if reportPath := strings.TrimSpace(*startupReportFile); reportPath != "" {
			if err := writeDesktopReadyLaunchReport(reportPath, runtimeStartupReport{
				LocalUIURL:         firstNonEmptyString(localUIURLs),
				LocalUIURLs:        append([]string(nil), localUIURLs...),
				EffectiveRunMode:   string(effectiveRunMode),
				RemoteEnabled:      controlChannelEnabled,
				DesktopManaged:     *desktopManaged,
				StateDir:           filepath.Dir(cfgPathAbs),
				DiagnosticsEnabled: a.DiagnosticsEnabled(),
			}, desktopLaunchStatusReady); err != nil {
				fmt.Fprintf(c.stderr, "failed to write desktop launch report: %v\n", err)
				return 1
			}
		}

		// In local-only modes, print after the Local UI is ready.
		// In remote-connected modes, print after the control channel connects so the
		// final portal URL and Local UI URL are both available together.
		if !controlChannelEnabled {
			announce()
		}
	}

	if err := a.Run(ctx); err != nil && ctx.Err() == nil {
		fmt.Fprintf(c.stderr, "agent exited with error: %v\n", err)
		return 1
	}
	return 0
}

func buildRunBootstrapArgs(
	configPath string,
	controlplane string,
	envID string,
	envToken string,
	permissionPolicy string,
	mode runMode,
	desktopManaged bool,
) config.BootstrapArgs {
	args := config.BootstrapArgs{
		ControlplaneBaseURL:    controlplane,
		EnvironmentID:          envID,
		EnvironmentToken:       envToken,
		ConfigPath:             configPath,
		PermissionPolicyPreset: permissionPolicy,
	}
	if mode == runModeDesktop && desktopManaged {
		// Desktop startup should stay on the normal logging baseline unless the
		// user later opts into debug mode explicitly from Agent Settings.
		args.LogLevel = "info"
	}
	return args
}

func (c *cli) printNotBootstrappedGuidance(reason error) int {
	writeErrorWithHelp(
		c.stderr,
		fmt.Sprintf("agent is not bootstrapped for remote or hybrid mode: %v", reason),
		[]string{
			"Hint: run `redeven bootstrap` first, or pass --controlplane, --env-id, and either --env-token or --env-token-env directly to `redeven run`.",
			"Examples:",
			fmt.Sprintf("  redeven bootstrap --controlplane %s --env-id %s --env-token %s", exampleControlplaneURL, exampleEnvID, exampleEnvToken),
			fmt.Sprintf("  redeven run --mode hybrid --controlplane %s --env-id %s --env-token %s", exampleControlplaneURL, exampleEnvID, exampleEnvToken),
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
