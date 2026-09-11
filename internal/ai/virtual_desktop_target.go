package ai

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"sync"
)

// XvfbTargetExecutor supplies the same typed contract to GUI programs on a
// headless Linux host. The wrapped executor is responsible for X11 input and
// screenshots; this type owns the display lifecycle and clear availability
// failure.
type XvfbTargetExecutor struct {
	Display string
	Screen  string
	Inner   TargetToolExecutor
	mu      sync.Mutex
	process *exec.Cmd
}

func (e *XvfbTargetExecutor) Start(ctx context.Context) error {
	if e == nil || e.Inner == nil {
		return errors.New("virtual desktop target executor is unavailable")
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.process != nil {
		return nil
	}
	display := strings.TrimSpace(e.Display)
	if display == "" {
		display = ":99"
	}
	screen := strings.TrimSpace(e.Screen)
	if screen == "" {
		screen = "1280x800x24"
	}
	path, err := exec.LookPath("Xvfb")
	if err != nil {
		return fmt.Errorf("TARGET_UNAVAILABLE: Xvfb is not installed")
	}
	cmd := exec.CommandContext(ctx, path, display, "-screen", "0", screen, "-nolisten", "tcp")
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("TARGET_UNAVAILABLE: start Xvfb: %w", err)
	}
	e.process = cmd
	return nil
}

func (e *XvfbTargetExecutor) ExecuteTargetTool(ctx context.Context, call TargetToolCall) (TargetToolResult, error) {
	e.mu.Lock()
	started := e.process != nil
	e.mu.Unlock()
	if !started {
		return TargetToolResult{}, errors.New("TARGET_UNAVAILABLE: Xvfb target is not started")
	}
	return e.Inner.ExecuteTargetTool(ctx, call)
}

func (e *XvfbTargetExecutor) ResolveTargetToolAttachment(ctx context.Context, ref string) ([]byte, error) {
	resolver, ok := e.Inner.(TargetToolAttachmentResolver)
	if !ok {
		return nil, errors.New("target attachment resolver is unavailable")
	}
	return resolver.ResolveTargetToolAttachment(ctx, ref)
}

func (e *XvfbTargetExecutor) Close() error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.process == nil {
		return nil
	}
	_ = e.process.Process.Kill()
	e.process = nil
	if closer, ok := e.Inner.(interface{ Close() error }); ok {
		return closer.Close()
	}
	return nil
}
