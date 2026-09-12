package ai

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// NativeDesktopTargetExecutor speaks the versioned JSONL protocol implemented
// by desktop/native/computer-host. The helper owns macOS Accessibility,
// CGEvent, and screen capture permissions; this adapter owns routing and
// opaque frame storage.
type NativeDesktopTargetExecutor struct {
	HelperPath string
	Timeout    time.Duration

	mu      sync.Mutex
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	reader  *bufio.Reader
	mediaMu sync.RWMutex
	media   map[string][]byte
}

func NewNativeDesktopTargetExecutor(helperPath string) *NativeDesktopTargetExecutor {
	return &NativeDesktopTargetExecutor{HelperPath: strings.TrimSpace(helperPath), Timeout: 30 * time.Second, media: map[string][]byte{}}
}

func (e *NativeDesktopTargetExecutor) ExecuteTargetTool(ctx context.Context, call TargetToolCall) (TargetToolResult, error) {
	if e == nil || e.HelperPath == "" {
		return TargetToolResult{}, errors.New("desktop target helper is unavailable")
	}
	args := map[string]any{}
	if len(call.Arguments) > 0 && string(call.Arguments) != "null" {
		if err := json.Unmarshal(call.Arguments, &args); err != nil {
			return TargetToolResult{}, fmt.Errorf("invalid desktop target arguments: %w", err)
		}
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if err := e.startLocked(ctx); err != nil {
		return TargetToolResult{}, err
	}
	requestID := fmt.Sprintf("%s-%d", strings.TrimSpace(call.ToolCallID), time.Now().UnixNano())
	payload, err := json.Marshal(map[string]any{"protocol_version": 1, "request_id": requestID, "target_id": call.TargetID, "tool_name": call.ToolName, "args": args})
	if err != nil {
		return TargetToolResult{}, err
	}
	if _, err := e.stdin.Write(append(payload, '\n')); err != nil {
		return TargetToolResult{}, err
	}
	deadline := e.Timeout
	if deadline <= 0 {
		deadline = 30 * time.Second
	}
	readCh := make(chan []byte, 1)
	errCh := make(chan error, 1)
	go func() {
		for {
			line, readErr := e.reader.ReadBytes('\n')
			if readErr != nil {
				errCh <- readErr
				return
			}
			line = bytes.TrimSpace(line)
			var envelope struct {
				Type string `json:"type"`
			}
			if json.Unmarshal(line, &envelope) == nil && (envelope.Type == "result" || envelope.Type == "error") {
				readCh <- line
				return
			}
		}
	}()
	timer := time.NewTimer(deadline)
	defer timer.Stop()
	var line []byte
	select {
	case <-ctx.Done():
		return TargetToolResult{}, ctx.Err()
	case <-timer.C:
		return TargetToolResult{}, context.DeadlineExceeded
	case err := <-errCh:
		return TargetToolResult{}, err
	case line = <-readCh:
	}
	var event struct {
		Type     string         `json:"type"`
		TargetID string         `json:"target_id"`
		Error    string         `json:"error"`
		Payload  map[string]any `json:"payload"`
	}
	if err := json.Unmarshal(line, &event); err != nil {
		return TargetToolResult{}, err
	}
	if event.Type == "error" || strings.TrimSpace(event.Error) != "" {
		return TargetToolResult{}, errors.New(event.Error)
	}
	if event.Type != "result" {
		return TargetToolResult{}, errors.New("desktop target helper returned no result")
	}
	result := TargetToolResult{TargetID: event.TargetID, ExecutionLocation: "macos_desktop", Result: event.Payload}
	result.ActionSummary = strings.TrimSpace(anyToString(event.Payload["summary"]))
	if mime := strings.TrimSpace(anyToString(event.Payload["screenshot_mime"])); mime != "" {
		if raw := strings.TrimSpace(anyToString(event.Payload["screenshot_base64"])); raw != "" {
			body, decodeErr := base64.StdEncoding.DecodeString(raw)
			if decodeErr != nil {
				return TargetToolResult{}, decodeErr
			}
			sum := sha256.Sum256(body)
			hash := hex.EncodeToString(sum[:])
			ref := "computer://" + event.TargetID + "/" + hash
			e.mediaMu.Lock()
			e.media[ref] = append([]byte(nil), body...)
			e.mediaMu.Unlock()
			result.Attachments = []TargetToolAttachment{{ResourceRef: ref, Name: "desktop-screenshot.png", MIMEType: mime, SizeBytes: int64(len(body)), SHA256: hash}}
			delete(event.Payload, "screenshot_base64")
			event.Payload["screenshot"] = ref
			event.Payload["after_frame"] = ref
		}
	}
	return result, nil
}

func (e *NativeDesktopTargetExecutor) startLocked(ctx context.Context) error {
	if e.cmd != nil {
		return nil
	}
	cmd := exec.CommandContext(ctx, e.HelperPath, "--protocol-version", "1")
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	cmd.Stderr = nil
	if err := cmd.Start(); err != nil {
		return err
	}
	e.cmd, e.stdin, e.reader = cmd, stdin, bufio.NewReader(stdout)
	return nil
}

func (e *NativeDesktopTargetExecutor) ResolveTargetToolAttachment(_ context.Context, ref string) ([]byte, error) {
	e.mediaMu.RLock()
	body, ok := e.media[strings.TrimSpace(ref)]
	e.mediaMu.RUnlock()
	if !ok {
		return nil, errors.New("unknown desktop target attachment")
	}
	return append([]byte(nil), body...), nil
}

func (e *NativeDesktopTargetExecutor) Close() error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.stdin != nil {
		_ = e.stdin.Close()
	}
	if e.cmd != nil && e.cmd.Process != nil {
		_ = e.cmd.Process.Kill()
	}
	e.cmd, e.stdin, e.reader = nil, nil, nil
	return nil
}
