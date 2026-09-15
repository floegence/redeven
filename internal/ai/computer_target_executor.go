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
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// PlaywrightTargetExecutor is the headless Linux BrowserTarget. The Node
// helper owns Playwright and browser profiles; this process owns target policy
// and opaque screenshot attachment bytes.
type PlaywrightTargetExecutor struct {
	NodeBinary string
	HelperPath string
	ProfileDir string
	CDPURL     string
	Timeout    time.Duration

	mu      sync.Mutex
	closed  bool
	clients map[string]*playwrightTargetClient
	mediaMu sync.RWMutex
	media   map[string][]byte
}

type playwrightTargetClient struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	reader *bufio.Reader
}

type playwrightTargetRequest struct {
	SessionID     string         `json:"session_id,omitempty"`
	UserControl   bool           `json:"user_control,omitempty"`
	ReturnControl bool           `json:"return_control,omitempty"`
	ID            string         `json:"id"`
	TargetID      string         `json:"target_id"`
	ToolName      string         `json:"tool_name"`
	Args          map[string]any `json:"args"`
}

type playwrightTargetResponse struct {
	Safety     *InteractionSafetyDecision `json:"safety,omitempty"`
	ID         string                     `json:"id"`
	TargetID   string                     `json:"target_id"`
	Location   string                     `json:"execution_location"`
	Result     map[string]any             `json:"result"`
	Error      string                     `json:"error,omitempty"`
	Screenshot *struct {
		MIME string `json:"mime"`
		Data string `json:"data"`
	} `json:"screenshot,omitempty"`
}

type playwrightTargetReady struct {
	Type            string `json:"type"`
	ProtocolVersion int    `json:"protocol_version"`
	Error           string `json:"error,omitempty"`
	Reason          string `json:"reason,omitempty"`
}

func NewPlaywrightTargetExecutor(nodeBinary, helperPath, profileDir string) *PlaywrightTargetExecutor {
	return &PlaywrightTargetExecutor{NodeBinary: nodeBinary, HelperPath: helperPath, ProfileDir: profileDir, Timeout: 30 * time.Second, clients: map[string]*playwrightTargetClient{}, media: map[string][]byte{}}
}

func (e *PlaywrightTargetExecutor) EnsureTargetReady(ctx context.Context, targetID string) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.closed {
		return errors.New("browser target executor is closed")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	_, err := e.clientLocked(ctx, targetID)
	return err
}

func (e *PlaywrightTargetExecutor) ExecuteTargetTool(ctx context.Context, call TargetToolCall) (TargetToolResult, error) {
	return e.executeTargetTool(ctx, call, false)
}

// User input uses the same serialized browser exchange, but its frames and
// inputs never enter model attachments, activity, or the executor media cache.
func (e *PlaywrightTargetExecutor) ExecuteComputerUserInput(ctx context.Context, call TargetToolCall) ([]byte, error) {
	result, err := e.executeTargetTool(ctx, call, true)
	return result.frameBytes, err
}

func (e *PlaywrightTargetExecutor) executeTargetTool(ctx context.Context, call TargetToolCall, userControl bool) (TargetToolResult, error) {
	if e == nil || strings.TrimSpace(e.HelperPath) == "" {
		return TargetToolResult{}, errors.New("browser target helper is unavailable")
	}
	targetID := strings.TrimSpace(call.TargetID)
	if targetID == "" {
		return TargetToolResult{}, errors.New("target_id is required")
	}
	if strings.ContainsAny(targetID, `/\\`) || targetID == "." || targetID == ".." {
		return TargetToolResult{}, errors.New("invalid target_id")
	}
	args := map[string]any{}
	if len(call.Arguments) > 0 && string(call.Arguments) != "null" {
		if err := json.Unmarshal(call.Arguments, &args); err != nil {
			return TargetToolResult{}, fmt.Errorf("invalid target arguments: %w", err)
		}
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.closed {
		return TargetToolResult{}, errors.New("browser target executor is closed")
	}
	if err := ctx.Err(); err != nil {
		return TargetToolResult{}, err
	}
	client, err := e.clientLocked(ctx, targetID)
	if err != nil {
		return TargetToolResult{}, err
	}
	// A response reader belongs to exactly one action. Once interrupted, retire
	// the session before accepting another action so late replies cannot leak
	// into the next tool result. Never replay an uncertain action automatically.
	healthy := false
	defer func() {
		if !healthy {
			stopPlaywrightClient(client)
			delete(e.clients, targetID)
		}
	}()
	requestID := fmt.Sprintf("%s-%d", strings.TrimSpace(call.ToolCallID), time.Now().UnixNano())
	request := playwrightTargetRequest{ID: requestID, TargetID: targetID, ToolName: strings.TrimSpace(call.ToolName), Args: args, UserControl: userControl, ReturnControl: call.controlReturn}
	if call.ThreadID != "" && call.TurnID != "" {
		// Canonical turn identity survives input continuation runs. Model args
		// cannot select a private browser session or end another turn's takeover.
		session := sha256.Sum256([]byte(call.ThreadID + "\x00" + call.TurnID))
		request.SessionID = hex.EncodeToString(session[:])
	}
	payload, err := json.Marshal(request)
	if err != nil {
		return TargetToolResult{}, err
	}
	if _, err := client.stdin.Write(append(payload, '\n')); err != nil {
		return TargetToolResult{}, err
	}
	lineCh := make(chan []byte, 1)
	errCh := make(chan error, 1)
	go func() {
		line, readErr := client.reader.ReadBytes('\n')
		if readErr != nil {
			errCh <- readErr
			return
		}
		lineCh <- bytes.TrimSpace(line)
	}()
	timeout := e.Timeout
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	var line []byte
	select {
	case <-ctx.Done():
		return TargetToolResult{}, ctx.Err()
	case <-timer.C:
		return TargetToolResult{}, context.DeadlineExceeded
	case err := <-errCh:
		return TargetToolResult{}, err
	case line = <-lineCh:
	}
	var response playwrightTargetResponse
	if err := json.Unmarshal(line, &response); err != nil {
		return TargetToolResult{}, fmt.Errorf("invalid browser helper response: %w", err)
	}
	if response.ID != requestID || response.TargetID != targetID {
		return TargetToolResult{}, errors.New("browser helper response provenance mismatch")
	}
	if strings.TrimSpace(response.Error) != "" {
		healthy = true
		return TargetToolResult{}, computerTargetFailure(call, response.Error)
	}
	result := TargetToolResult{TargetID: targetID, ExecutionLocation: response.Location, Result: response.Result, Safety: response.Safety}
	if response.Result != nil {
		result.ActionSummary = strings.TrimSpace(anyToString(response.Result["summary"]))
	}
	if !userControl && result.Safety != nil && (!result.Safety.SafeToCapture || !result.Safety.SafeToSendToModel) {
		healthy = true
		return result, nil
	}
	if response.Screenshot != nil && strings.TrimSpace(response.Screenshot.Data) != "" {
		body, err := base64.StdEncoding.DecodeString(response.Screenshot.Data)
		if err != nil {
			return TargetToolResult{}, fmt.Errorf("decode browser screenshot: %w", err)
		}
		sum := sha256.Sum256(body)
		ref := "computer://" + targetID + "/" + hex.EncodeToString(sum[:])
		result.frameBytes = body
		if userControl {
			healthy = true
			return result, nil
		}
		e.mediaMu.Lock()
		e.media[ref] = append([]byte(nil), body...)
		e.mediaMu.Unlock()
		mime := strings.TrimSpace(response.Screenshot.MIME)
		if mime == "" {
			mime = "image/png"
		}
		result.Attachments = []TargetToolAttachment{{ResourceRef: ref, Name: "browser-screenshot.png", MIMEType: mime, SizeBytes: int64(len(body)), SHA256: hex.EncodeToString(sum[:])}}
		if payload, ok := result.Result.(map[string]any); ok {
			payload["before_frame"] = ref
			payload["after_frame"] = ref
			payload["screenshot"] = ref
			result.Result = payload
		}
	}
	healthy = true
	return result, nil
}

func (e *PlaywrightTargetExecutor) clientLocked(ctx context.Context, targetID string) (*playwrightTargetClient, error) {
	if client := e.clients[targetID]; client != nil {
		return client, nil
	}
	if !filepath.IsAbs(e.NodeBinary) || !filepath.IsAbs(e.HelperPath) || !filepath.IsAbs(e.ProfileDir) {
		return nil, &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: "browser_paths_not_absolute"}
	}
	profile := e.ProfileDir
	profile = filepath.Join(profile, targetID)
	if err := os.MkdirAll(profile, 0o700); err != nil {
		return nil, err
	}
	// The helper is a target-scoped session, so it must outlive the individual
	// tool call that created it. Binding the child to that call's context would
	// terminate the browser immediately after the first action and make every
	// subsequent action fail with a broken pipe.
	args := []string{e.HelperPath, "--profile", profile}
	if strings.TrimSpace(e.CDPURL) != "" {
		args = append(args, "--cdp-url", e.CDPURL)
	}
	cmd := exec.Command(e.NodeBinary, args...)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	cmd.Stderr = io.Discard
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	client := &playwrightTargetClient{cmd: cmd, stdin: stdin, reader: bufio.NewReader(stdout)}
	ready := false
	defer func() {
		if !ready {
			stopPlaywrightClient(client)
		}
	}()
	readyCh := make(chan []byte, 1)
	errCh := make(chan error, 1)
	go func() {
		line, readErr := client.reader.ReadBytes('\n')
		if readErr != nil {
			errCh <- readErr
			return
		}
		readyCh <- bytes.TrimSpace(line)
	}()
	readyTimeout := e.Timeout
	if readyTimeout <= 0 {
		readyTimeout = 30 * time.Second
	}
	timer := time.NewTimer(readyTimeout)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-timer.C:
		return nil, context.DeadlineExceeded
	case <-errCh:
		return nil, &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: "browser_handshake_missing"}
	case line := <-readyCh:
		var handshake playwrightTargetReady
		if err := json.Unmarshal(line, &handshake); err != nil || handshake.Type != "ready" || handshake.ProtocolVersion != 1 {
			return nil, &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: "browser_handshake_invalid"}
		}
		if handshake.Error != "" {
			code := handshake.Error
			if code != "TARGET_CONNECTION_REQUIRED" {
				code = "TARGET_SETUP_REQUIRED"
			}
			reason := "browser_launch_failed"
			switch handshake.Reason {
			case "browser_dependency_missing", "browser_connection_failed", "browser_launch_failed":
				reason = handshake.Reason
			}
			return nil, &TargetStartupError{Code: code, Reason: reason}
		}
	}
	ready = true
	e.clients[targetID] = client
	return client, nil
}

func (e *PlaywrightTargetExecutor) ResolveTargetToolAttachment(_ context.Context, resourceRef string) ([]byte, error) {
	e.mediaMu.RLock()
	body, ok := e.media[strings.TrimSpace(resourceRef)]
	e.mediaMu.RUnlock()
	if !ok {
		return nil, errors.New("unknown target attachment")
	}
	return append([]byte(nil), body...), nil
}

func (e *PlaywrightTargetExecutor) Close() error {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.closed = true
	for id, client := range e.clients {
		stopPlaywrightClient(client)
		delete(e.clients, id)
	}
	return nil
}

func stopPlaywrightClient(client *playwrightTargetClient) {
	_ = client.stdin.Close()
	// Give Playwright a chance to close its Chromium children and profile lock.
	if err := client.cmd.Process.Signal(os.Interrupt); err != nil {
		_ = client.cmd.Process.Kill()
	}
	done := make(chan struct{})
	go func() { _ = client.cmd.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		_ = client.cmd.Process.Kill()
		<-done
	}
}

func (e *PlaywrightTargetExecutor) releaseTargetFrame(ref string) {
	e.mediaMu.Lock()
	defer e.mediaMu.Unlock()
	delete(e.media, ref)
}
