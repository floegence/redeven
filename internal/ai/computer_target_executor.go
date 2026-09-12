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
	Timeout    time.Duration

	mu      sync.Mutex
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
	ID       string         `json:"id"`
	TargetID string         `json:"target_id"`
	ToolName string         `json:"tool_name"`
	Args     map[string]any `json:"args"`
}

type playwrightTargetResponse struct {
	ID         string         `json:"id"`
	TargetID   string         `json:"target_id"`
	Location   string         `json:"execution_location"`
	Result     map[string]any `json:"result"`
	Error      string         `json:"error,omitempty"`
	Screenshot *struct {
		MIME string `json:"mime"`
		Data string `json:"data"`
	} `json:"screenshot,omitempty"`
}

func NewPlaywrightTargetExecutor(nodeBinary, helperPath, profileDir string) *PlaywrightTargetExecutor {
	if strings.TrimSpace(nodeBinary) == "" {
		nodeBinary = "node"
	}
	return &PlaywrightTargetExecutor{NodeBinary: nodeBinary, HelperPath: helperPath, ProfileDir: profileDir, Timeout: 30 * time.Second, clients: map[string]*playwrightTargetClient{}, media: map[string][]byte{}}
}

func (e *PlaywrightTargetExecutor) ExecuteTargetTool(ctx context.Context, call TargetToolCall) (TargetToolResult, error) {
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
	client, err := e.clientLocked(ctx, targetID)
	e.mu.Unlock()
	if err != nil {
		return TargetToolResult{}, err
	}
	requestID := fmt.Sprintf("%s-%d", strings.TrimSpace(call.ToolCallID), time.Now().UnixNano())
	request := playwrightTargetRequest{ID: requestID, TargetID: targetID, ToolName: strings.TrimSpace(call.ToolName), Args: args}
	payload, err := json.Marshal(request)
	if err != nil {
		return TargetToolResult{}, err
	}
	e.mu.Lock()
	defer e.mu.Unlock()
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
	if strings.TrimSpace(response.Error) != "" {
		return TargetToolResult{}, errors.New(response.Error)
	}
	result := TargetToolResult{TargetID: targetID, ExecutionLocation: response.Location, Result: response.Result}
	if response.Result != nil {
		result.ActionSummary = strings.TrimSpace(anyToString(response.Result["summary"]))
	}
	if response.Screenshot != nil && strings.TrimSpace(response.Screenshot.Data) != "" {
		body, err := base64.StdEncoding.DecodeString(response.Screenshot.Data)
		if err != nil {
			return TargetToolResult{}, fmt.Errorf("decode browser screenshot: %w", err)
		}
		sum := sha256.Sum256(body)
		ref := "computer://" + targetID + "/" + hex.EncodeToString(sum[:])
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
	return result, nil
}

func (e *PlaywrightTargetExecutor) clientLocked(ctx context.Context, targetID string) (*playwrightTargetClient, error) {
	if client := e.clients[targetID]; client != nil {
		return client, nil
	}
	profile := e.ProfileDir
	if profile == "" {
		profile = filepath.Join(os.TempDir(), "redeven-computer-use")
	}
	profile = filepath.Join(profile, targetID)
	if err := os.MkdirAll(profile, 0o700); err != nil {
		return nil, err
	}
	cmd := exec.CommandContext(ctx, e.NodeBinary, e.HelperPath, "--profile", profile)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	client := &playwrightTargetClient{cmd: cmd, stdin: stdin, reader: bufio.NewReader(stdout)}
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
	for id, client := range e.clients {
		_ = client.stdin.Close()
		_ = client.cmd.Process.Kill()
		delete(e.clients, id)
	}
	return nil
}
