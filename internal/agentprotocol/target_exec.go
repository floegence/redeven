package agentprotocol

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/processenv"
)

const (
	targetExecDefaultTimeout = 120 * time.Second
	targetExecMaxTimeout     = 10 * time.Minute
	targetExecOutputLimit    = 200_000
)

type TargetExecOptions struct {
	StateRoot string
	Target    string
	Command   string
	CWD       string
	Timeout   time.Duration
	Runner    TargetExecRunner
}

type TargetExecInvocation struct {
	ExecutionLocation        string
	Command                  string
	CWD                      string
	Shell                    string
	SSHDestination           string
	SSHPort                  *int
	SSHAuthMode              string
	SSHConnectTimeoutSeconds int
	Env                      []string
}

type TargetExecProcessResult struct {
	Stdout     string
	Stderr     string
	ExitCode   int
	DurationMS int64
	TimedOut   bool
	Truncated  bool
}

type TargetExecRunner func(ctx context.Context, inv TargetExecInvocation) (TargetExecProcessResult, error)

type TargetExecResult struct {
	Target            TargetDescriptor `json:"target"`
	TargetID          string           `json:"target_id"`
	Supported         bool             `json:"supported"`
	ReasonCode        string           `json:"reason_code,omitempty"`
	Message           string           `json:"message,omitempty"`
	ExecutionLocation string           `json:"execution_location,omitempty"`
	Command           string           `json:"command,omitempty"`
	CWD               string           `json:"cwd,omitempty"`
	Stdout            string           `json:"stdout,omitempty"`
	Stderr            string           `json:"stderr,omitempty"`
	ExitCode          int              `json:"exit_code"`
	DurationMS        int64            `json:"duration_ms,omitempty"`
	TimedOut          bool             `json:"timed_out,omitempty"`
	Truncated         bool             `json:"truncated,omitempty"`
}

func ExecuteTargetCommand(ctx context.Context, opts TargetExecOptions) (TargetExecResult, error) {
	command := strings.TrimSpace(opts.Command)
	if command == "" {
		return TargetExecResult{}, errors.New("missing command")
	}
	catalog, err := DiscoverTargets(DiscoverTargetsOptions{StateRoot: opts.StateRoot})
	if err != nil {
		return TargetExecResult{}, err
	}
	target, err := ResolveTargetForExecution(catalog, opts.Target)
	if err != nil {
		return TargetExecResult{}, err
	}
	result := TargetExecResult{
		Target:    sanitizeTargetForExecutionResult(target),
		TargetID:  strings.TrimSpace(target.ID),
		Supported: true,
		Command:   command,
		CWD:       strings.TrimSpace(opts.CWD),
	}
	route := target.Execution
	if route == nil || strings.TrimSpace(route.Location) == "" {
		result.Supported = false
		result.ReasonCode = TargetExecReasonUnsupportedTargetKind
		result.Message = targetExecUnsupportedMessage(target.Kind)
		return result, nil
	}
	if route.Location == TargetExecutionLocationSSH && strings.TrimSpace(route.SSHAuthMode) == "password" {
		result.Supported = false
		result.ReasonCode = TargetExecReasonPasswordAuthUnavailable
		result.Message = "This target uses password SSH authentication; `redeven targets exec` does not access Desktop-stored SSH secrets. Reconfigure the target for key/agent auth or run the operation from Redeven Desktop."
		return result, nil
	}

	timeout := normalizeTargetExecTimeout(opts.Timeout)
	if ctx == nil {
		ctx = context.Background()
	}
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	runner := opts.Runner
	if runner == nil {
		runner = defaultTargetExecRunner
	}
	processResult, err := runner(runCtx, TargetExecInvocation{
		ExecutionLocation:        strings.TrimSpace(route.Location),
		Command:                  command,
		CWD:                      strings.TrimSpace(opts.CWD),
		Shell:                    strings.TrimSpace(target.Shell),
		SSHDestination:           strings.TrimSpace(route.SSHDestination),
		SSHPort:                  route.SSHPort,
		SSHAuthMode:              strings.TrimSpace(route.SSHAuthMode),
		SSHConnectTimeoutSeconds: route.SSHConnectTimeoutSeconds,
		Env:                      processenv.Current(),
	})
	if err != nil {
		return TargetExecResult{}, err
	}
	result.ExecutionLocation = strings.TrimSpace(route.Location)
	result.Stdout = processResult.Stdout
	result.Stderr = processResult.Stderr
	result.ExitCode = processResult.ExitCode
	result.DurationMS = processResult.DurationMS
	result.TimedOut = processResult.TimedOut
	result.Truncated = processResult.Truncated
	return result, nil
}

func normalizeTargetExecTimeout(timeout time.Duration) time.Duration {
	if timeout <= 0 {
		return targetExecDefaultTimeout
	}
	if timeout > targetExecMaxTimeout {
		return targetExecMaxTimeout
	}
	return timeout
}

func defaultTargetExecRunner(ctx context.Context, inv TargetExecInvocation) (TargetExecProcessResult, error) {
	started := time.Now()
	cmd, err := targetExecCommand(ctx, inv)
	if err != nil {
		return TargetExecProcessResult{}, err
	}
	stdout := &cappedOutputBuffer{limit: targetExecOutputLimit}
	stderr := &cappedOutputBuffer{limit: targetExecOutputLimit}
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	if len(inv.Env) > 0 {
		cmd.Env = processenv.Filter(inv.Env)
	}
	err = cmd.Run()
	timedOut := ctx != nil && ctx.Err() != nil
	exitCode := 0
	if err != nil {
		var exitErr *exec.ExitError
		switch {
		case timedOut:
			exitCode = 124
		case errors.As(err, &exitErr):
			exitCode = exitErr.ExitCode()
		default:
			return TargetExecProcessResult{}, err
		}
	}
	return TargetExecProcessResult{
		Stdout:     stdout.String(),
		Stderr:     stderr.String(),
		ExitCode:   exitCode,
		DurationMS: time.Since(started).Milliseconds(),
		TimedOut:   timedOut,
		Truncated:  stdout.truncated || stderr.truncated,
	}, nil
}

func targetExecCommand(ctx context.Context, inv TargetExecInvocation) (*exec.Cmd, error) {
	switch strings.TrimSpace(inv.ExecutionLocation) {
	case TargetExecutionLocationLocalRuntime, TargetExecutionLocationLocalHost:
		shell := strings.TrimSpace(inv.Shell)
		if shell == "" {
			shell = "/bin/bash"
		}
		cmd := exec.CommandContext(ctx, shell, "-lc", inv.Command)
		if cwd := strings.TrimSpace(inv.CWD); cwd != "" {
			cmd.Dir = cwd
		}
		return cmd, nil
	case TargetExecutionLocationSSH:
		if strings.TrimSpace(inv.SSHDestination) == "" {
			return nil, errors.New("missing ssh destination")
		}
		connectTimeout := inv.SSHConnectTimeoutSeconds
		if connectTimeout <= 0 {
			connectTimeout = 10
		}
		remoteCommand := inv.Command
		if cwd := strings.TrimSpace(inv.CWD); cwd != "" {
			remoteCommand = "cd " + shellQuoteArg(cwd) + " && " + remoteCommand
		}
		args := []string{
			"-T",
			"-x",
			"-o",
			fmt.Sprintf("ConnectTimeout=%d", connectTimeout),
			"-o",
			"BatchMode=yes",
		}
		if inv.SSHPort != nil {
			args = append(args, "-p", fmt.Sprintf("%d", *inv.SSHPort))
		}
		args = append(args, strings.TrimSpace(inv.SSHDestination), remoteCommand)
		return exec.CommandContext(ctx, "ssh", args...), nil
	default:
		return nil, fmt.Errorf("unsupported execution location: %s", strings.TrimSpace(inv.ExecutionLocation))
	}
}

type cappedOutputBuffer struct {
	buf       bytes.Buffer
	limit     int
	truncated bool
}

func (b *cappedOutputBuffer) Write(p []byte) (int, error) {
	if b.limit <= 0 {
		return len(p), nil
	}
	remaining := b.limit - b.buf.Len()
	if remaining <= 0 {
		b.truncated = b.truncated || len(p) > 0
		return len(p), nil
	}
	if len(p) > remaining {
		_, _ = b.buf.Write(p[:remaining])
		b.truncated = true
		return len(p), nil
	}
	_, _ = b.buf.Write(p)
	return len(p), nil
}

func (b *cappedOutputBuffer) String() string {
	if b == nil {
		return ""
	}
	return b.buf.String()
}

func sanitizeTargetForExecutionResult(target TargetDescriptor) TargetDescriptor {
	target.StateRoot = ""
	target.StateDir = ""
	target.ConfigPath = ""
	target.RuntimeControlSocketPath = ""
	target.AgentHomeDir = ""
	target.Shell = ""
	return target
}

func targetExecUnsupportedMessage(kind string) string {
	switch strings.TrimSpace(kind) {
	case TargetKindLocalContainerRuntime:
		return "Redeven recognized this local container target, but `redeven targets exec` does not execute inside container placements in this version."
	case TargetKindSSHContainerRuntime:
		return "Redeven recognized this SSH container target, but `redeven targets exec` does not execute inside remote container placements in this version."
	case TargetKindSSHEnvironment:
		return "Redeven recognized this SSH target, but no saved SSH execution route is available for `redeven targets exec`."
	case TargetKindProviderEnvironment:
		return "Redeven recognized this provider environment target, but target command execution requires a concrete local or SSH runtime target."
	case TargetKindGatewayEnvironment:
		return "Redeven recognized this Gateway target, but target command execution requires a concrete local or SSH runtime target."
	case TargetKindExternalLocalUI:
		return "Redeven recognized this external Local UI target, but this CLI does not own command execution for that target."
	default:
		return "Command execution is not available for this target through `redeven targets exec`."
	}
}
