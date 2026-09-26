package ai

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/floegence/redeven/internal/browserstore"
)

const (
	browserHostProtocolVersion       = 1
	browserProjectionProtocolVersion = 24
	browserMediaWireVersion          = 1
)

// Explicit startup CDP configuration follows the same source owner as pages
// connected later through the product UI. It cannot fall back to a page helper.
func (r *ComputerUseRuntime) prepareRegisteredBrowserSource(ctx context.Context, target string) error {
	r.connectMu.Lock()
	defer r.connectMu.Unlock()
	r.mu.RLock()
	executor, ok := r.executors[target].(*PlaywrightTargetExecutor)
	needed := ok && executor.runtimeManaged && executor.CDPURL != "" && executor.sourceHost == nil
	r.mu.RUnlock()
	if !needed {
		return nil
	}
	if _, err := r.managedResources(); err != nil {
		return err
	}
	host, err := r.browserSourceHostLocked(ctx)
	if err != nil {
		return err
	}
	executor.mu.Lock()
	defer executor.mu.Unlock()
	if executor.closed || len(executor.clients) != 0 {
		return errors.New("browser source already initialized")
	}
	r.mu.Lock()
	executor.sourceHost = host
	r.mu.Unlock()
	return nil
}

// Called with connectMu held. Recovery is explicit and retires all old grants.
func (r *ComputerUseRuntime) browserSourceHostLocked(ctx context.Context) (*browserSourceHost, error) {
	status := r.browserServiceSnapshot()
	if status.State == "recovering" || status.State == "failed" {
		return nil, errBrowserHostFailed
	}
	if r.browserHost != nil {
		if err := r.browserHost.ctx.Err(); err != nil {
			return nil, errBrowserHostFailed
		}
		return r.browserHost, nil
	}
	resources, err := r.managedResources()
	if err != nil {
		return nil, err
	}
	generation := r.browserServiceSnapshot().Generation
	host, err := startBrowserSourceHost(ctx, resources.NodeBinary, filepath.Join(filepath.Dir(resources.HelperPath), "redevenBrowserHost.mjs"), browserHostHandlers{Directory: r.browserDirectoryCommand, Event: func(event browserHostEvent) { r.browserSourceGenerationEvent(generation, event) }})
	if err != nil {
		r.browserHostStopped(generation)
		return nil, err
	}
	r.browserHost = host
	r.mu.Lock()
	r.browserService.State = "ready"
	r.mu.Unlock()
	go func() { <-host.ctx.Done(); r.browserHostStopped(generation) }()
	return host, nil
}

type browserHostEvent struct {
	Type   string            `json:"type"`
	ID     string            `json:"id,omitempty"`
	View   string            `json:"view,omitempty"`
	Target string            `json:"target,omitempty"`
	TabID  string            `json:"tab_id,omitempty"`
	Action json.RawMessage   `json:"action,omitempty"`
	Tab    *browserstore.Tab `json:"tab,omitempty"`
}

type browserHostHandlers struct {
	Directory func(context.Context, browserHostEvent) (string, error)
	Event     func(browserHostEvent)
}

// The Runtime owns one source host. HTTP over its private Unix socket separates
// request lifetimes and data lanes; canceling one target never kills its peers.
// The socket and helper endpoint are never sent to a browser renderer.
type browserSourceHost struct {
	ctx       context.Context
	cancel    context.CancelFunc
	client    *http.Client
	cmd       *exec.Cmd
	stdin     io.WriteCloser
	directory string
	done      chan struct{}
	sequence  atomic.Uint64
	writeMu   sync.Mutex
	closeOnce sync.Once
	handlers  browserHostHandlers
}

func startBrowserSourceHost(ctx context.Context, node, helper string, handlers browserHostHandlers) (*browserSourceHost, error) {
	if !filepath.IsAbs(node) || !filepath.IsAbs(helper) {
		return nil, errors.New("browser host paths must be absolute")
	}
	directory, err := os.MkdirTemp("", "rdb-")
	if err != nil {
		return nil, err
	}
	socket := filepath.Join(directory, "host.sock")
	lifetime, cancel := context.WithCancel(context.Background())
	host := &browserSourceHost{ctx: lifetime, cancel: cancel, directory: directory, done: make(chan struct{}), handlers: handlers}
	host.client = &http.Client{Transport: &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "unix", socket)
		},
		MaxIdleConns: 32, MaxIdleConnsPerHost: 32, IdleConnTimeout: time.Minute,
	}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	cmd := exec.Command(node, helper, socket)
	host.cmd = cmd
	stdin, err := cmd.StdinPipe()
	if err != nil {
		cancel()
		_ = os.RemoveAll(directory)
		return nil, err
	}
	host.stdin = stdin
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		_ = stdin.Close()
		cancel()
		_ = os.RemoveAll(directory)
		return nil, err
	}
	cmd.Stderr = io.Discard
	if err := cmd.Start(); err != nil {
		_ = stdin.Close()
		cancel()
		_ = os.RemoveAll(directory)
		return nil, err
	}
	go func() {
		err := cmd.Wait()
		if err != nil && lifetime.Err() == nil {
			slog.Warn("browser source host exited", "pid", cmd.Process.Pid, "exit_code", cmd.ProcessState.ExitCode())
		}
		cancel()
		close(host.done)
	}()
	reader := bufio.NewReader(stdout)
	ready := make(chan error, 1)
	go func() {
		line, err := readComputerLine(reader, 16384)
		if err == nil {
			var response struct {
				Type    string `json:"type"`
				Version int    `json:"protocol_version"`
				Browser int    `json:"browser_protocol_version"`
				Media   int    `json:"media_wire_version"`
				Error   string `json:"error"`
			}
			if json.Unmarshal(line, &response) != nil || response.Type != "ready" || response.Version != browserHostProtocolVersion || response.Browser != browserProjectionProtocolVersion || response.Media != browserMediaWireVersion || response.Error != "" {
				err = errors.New("browser host protocol mismatch")
			}
		}
		ready <- err
	}()
	timer := time.NewTimer(20 * time.Second)
	defer timer.Stop()
	select {
	case err := <-ready:
		if err != nil {
			_ = host.Close()
			return nil, &TargetStartupError{Code: "TARGET_SETUP_REQUIRED", Reason: "browser_host_handshake_invalid"}
		}
	case <-ctx.Done():
		_ = host.Close()
		return nil, ctx.Err()
	case <-timer.C:
		_ = host.Close()
		return nil, context.DeadlineExceeded
	}
	go host.events(reader)
	return host, nil
}

func (host *browserSourceHost) events(reader *bufio.Reader) {
	defer host.Close()
	for {
		line, err := readComputerLine(reader, 32768)
		if err != nil {
			return
		}
		var event browserHostEvent
		if json.Unmarshal(line, &event) != nil {
			return
		}
		switch event.Type {
		case "directory_request":
			if event.ID == "" || event.View == "" || len(event.ID) > 128 || len(event.View) > 128 {
				return
			}
			go host.directoryReply(event)
		case "source_closed", "source_fault", "view_fault", "source_changed", "source_popup", "view_selected":
			if host.handlers.Event != nil {
				host.handlers.Event(event)
			}
		default:
			return
		}
	}
}

func (host *browserSourceHost) directoryReply(event browserHostEvent) {
	var action browserDirectoryAction
	_ = json.Unmarshal(event.Action, &action)
	ctx, cancel := context.WithCancel(host.ctx)
	if action.Kind != "close" {
		cancel()
		ctx, cancel = context.WithTimeout(host.ctx, 25*time.Second)
	}
	defer cancel()
	var target string
	err := errors.New("browser directory is unavailable")
	if host.handlers.Directory != nil {
		target, err = host.handlers.Directory(ctx, event)
	}
	response := map[string]any{"type": "directory_reply", "id": event.ID}
	if err != nil {
		response["error"] = "browser_directory_failed"
	} else if target != "" {
		response["target"] = target
	}
	body, _ := json.Marshal(response)
	host.writeMu.Lock()
	_, writeErr := host.stdin.Write(append(body, '\n'))
	host.writeMu.Unlock()
	if writeErr != nil {
		_ = host.Close()
	}
}

type browserHostBody struct {
	io.ReadCloser
	release func()
}

func (body *browserHostBody) Close() error {
	body.release()
	return body.ReadCloser.Close()
}

func (host *browserSourceHost) request(ctx context.Context, method, route string, body io.Reader) (*http.Response, error) {
	if err := host.ctx.Err(); err != nil {
		return nil, errBrowserHostFailed
	}
	ctx, cancel := context.WithCancel(ctx)
	stop := context.AfterFunc(host.ctx, cancel)
	release := func() { stop(); cancel() }
	request, err := http.NewRequestWithContext(ctx, method, "http://runtime.invalid"+route, body)
	if err != nil {
		release()
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := host.client.Do(request)
	if err != nil {
		release()
		return nil, err
	}
	response.Body = &browserHostBody{ReadCloser: response.Body, release: release}
	return response, nil
}

func (host *browserSourceHost) call(ctx context.Context, method string, params, result any) error {
	id := strconv.FormatUint(host.sequence.Add(1), 10)
	body, err := json.Marshal(map[string]any{"id": id, "method": method, "params": params})
	if err != nil || len(body) > 256*1024 {
		return errors.New("invalid browser host command")
	}
	response, err := host.request(ctx, http.MethodPost, "/command", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("browser host %s: %w", method, err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return errors.New("browser host command unavailable")
	}
	payload, err := io.ReadAll(io.LimitReader(response.Body, (24<<20)+1))
	if err != nil {
		return err
	}
	if len(payload) > 24<<20 {
		return errors.New("invalid browser host response")
	}
	var reply struct {
		ID     string          `json:"id"`
		Result json.RawMessage `json:"result"`
		Error  string          `json:"error"`
	}
	if json.Unmarshal(payload, &reply) != nil || reply.ID != id {
		return errors.New("browser host response provenance mismatch")
	}
	if reply.Error != "" {
		return fmt.Errorf("browser host: %s", reply.Error)
	}
	if result != nil {
		if len(reply.Result) == 0 {
			return errors.New("browser host result missing")
		}
		return json.Unmarshal(reply.Result, result)
	}
	return nil
}

func (host *browserSourceHost) Close() error {
	if host == nil {
		return nil
	}
	host.closeOnce.Do(func() {
		host.cancel()
		host.client.CloseIdleConnections()
		_ = host.stdin.Close()
		select {
		case <-host.done:
		case <-time.After(2 * time.Second):
			_ = host.cmd.Process.Kill()
			<-host.done
		}
		_ = os.RemoveAll(host.directory)
	})
	return nil
}
