// Package gatewaymembership owns the single Gateway member authority used by
// standalone access and optional Cloud publication.
package gatewaymembership

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sync"
	"time"

	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

const hookOutputLimit = 32 * 1024

// HookCommand is local host configuration. Product APIs never accept its path
// or arguments. A missing hook leaves the built-in authorization result intact.
type HookCommand struct {
	Path      string   `json:"path"`
	Arguments []string `json:"arguments"`
}

type HookConfig map[gp.HookAction]HookCommand

type PolicyHooks struct {
	mu      sync.RWMutex
	config  HookConfig
	permits chan struct{}
}

func NewPolicyHooks(config HookConfig) (*PolicyHooks, error) {
	hooks := &PolicyHooks{permits: make(chan struct{}, 8)}
	if err := hooks.Replace(config); err != nil {
		return nil, err
	}
	return hooks, nil
}

// Invalidate rejects all actions until the host supplies a valid replacement.
func (h *PolicyHooks) Invalidate() {
	h.mu.Lock()
	h.config = nil
	h.mu.Unlock()
}

// Replace installs a complete validated configuration. Invalid refresh fails
// closed for all configured actions instead of retaining stale executable policy.
func (h *PolicyHooks) Replace(config HookConfig) error {
	next := make(HookConfig, len(config))
	for action, command := range config {
		if !validHookAction(action) || !filepath.IsAbs(command.Path) || len(command.Arguments) > 64 {
			h.Invalidate()
			return errors.New("invalid Gateway policy hook configuration")
		}
		command.Arguments = append([]string(nil), command.Arguments...)
		next[action] = command
	}
	h.mu.Lock()
	h.config = next
	h.mu.Unlock()
	return nil
}

func validHookAction(action gp.HookAction) bool {
	return action == gp.HookMemberAdmit || action == gp.HookAccessOpen || action == gp.HookCloudPublish
}

var hookReason = regexp.MustCompile(`^[A-Z][A-Z0-9_]{0,63}$`)

// Evaluate can only further deny a previously authorized operation. Callers
// perform invitation, pairing, membership and built-in policy checks first.
func (h *PolicyHooks) Evaluate(ctx context.Context, input gp.HookInput) gp.HookResult {
	deny := func(code string) gp.HookResult { return gp.HookResult{Version: 1, ReasonCode: code} }
	if h == nil || ctx == nil || input.Version != 1 || !validHookAction(input.Action) || input.PolicyRevision < 1 || input.GatewayID == "" {
		return deny("POLICY_INVALID")
	}
	h.mu.RLock()
	command, configured := h.config[input.Action]
	valid := h.config != nil
	h.mu.RUnlock()
	if !valid {
		return deny("POLICY_CONFIG_INVALID")
	}
	if !configured {
		return gp.HookResult{Version: 1, Allowed: true, ReasonCode: "NO_HOOK"}
	}
	select {
	case h.permits <- struct{}{}:
		defer func() { <-h.permits }()
	default:
		return deny("POLICY_BUSY")
	}
	raw, err := json.Marshal(input)
	if err != nil || len(raw) > 8192 {
		return deny("POLICY_INPUT_INVALID")
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	commandProcess := exec.CommandContext(ctx, command.Path, command.Arguments...)
	commandProcess.Env = []string{"PATH=" + os.Getenv("PATH"), "LANG=C", "LC_ALL=C"}
	if root := os.Getenv("SystemRoot"); root != "" {
		commandProcess.Env = append(commandProcess.Env, "SystemRoot="+root)
	}
	commandProcess.Stdin = bytes.NewReader(raw)
	commandProcess.Stderr = io.Discard
	commandProcess.WaitDelay = 100 * time.Millisecond
	output := &hookOutput{cancel: cancel}
	commandProcess.Stdout = output
	err = commandProcess.Run()
	if output.overflow {
		return deny("POLICY_OUTPUT_LIMIT")
	}
	if ctx.Err() != nil {
		return deny("POLICY_TIMEOUT")
	}
	if err != nil {
		return deny("POLICY_EXEC_FAILED")
	}
	var result gp.HookResult
	decoder := json.NewDecoder(bytes.NewReader(output.data.Bytes()))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&result) != nil || decoder.Decode(new(any)) != io.EOF || result.Version != 1 || !hookReason.MatchString(result.ReasonCode) {
		return deny("POLICY_OUTPUT_INVALID")
	}
	return result
}

type hookOutput struct {
	data     bytes.Buffer
	overflow bool
	cancel   context.CancelFunc
}

func (w *hookOutput) Write(p []byte) (int, error) {
	if len(p) > hookOutputLimit-w.data.Len() {
		w.overflow = true
		w.cancel()
		return 0, errors.New("policy output limit")
	}
	return w.data.Write(p)
}

// Status exposes configuration presence without executable paths or arguments.
func (h *PolicyHooks) Status() map[gp.HookAction]gp.HookStatus {
	h.mu.RLock()
	defer h.mu.RUnlock()
	result := make(map[gp.HookAction]gp.HookStatus, 3)
	for _, action := range []gp.HookAction{gp.HookMemberAdmit, gp.HookAccessOpen, gp.HookCloudPublish} {
		result[action] = gp.HookNotConfigured
		if h.config == nil {
			result[action] = gp.HookInvalid
		} else if _, ok := h.config[action]; ok {
			result[action] = gp.HookConfigured
		}
	}
	return result
}
