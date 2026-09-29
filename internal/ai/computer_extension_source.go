package ai

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"github.com/floegence/redeven/internal/browserbridge"
)

// The private source socket separates tab traffic from the helper's small
// lifecycle pipe. Native messages carry one current binding generation; neither
// a renderer nor a model receives this debugger transport.
type extensionSourcePipe struct {
	client          *computerExtensionClient
	conn            net.Conn
	binding, tab    string
	target, request string
	ctx             context.Context
	cancel          context.CancelFunc
	queue           chan json.RawMessage
	bytes           atomic.Int64
	slots           chan struct{}
	once            sync.Once
	retired         chan struct{}
	retireError     error
}

func (host *browserSourceHost) attachExtension(ctx context.Context, client *computerExtensionClient, target, tab, binding string) (_ *extensionSourcePipe, resultErr error) {
	conn, err := (&net.Dialer{}).DialContext(ctx, "unix", filepath.Join(host.directory, "host.sock"))
	if err != nil {
		return nil, err
	}
	success := false
	stopCancellation := context.AfterFunc(ctx, func() { _ = conn.Close() })
	defer func() {
		stopCancellation()
		if !success {
			_ = conn.Close()
			if err := ctx.Err(); err != nil {
				resultErr = err
			}
		}
	}()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	request, _ := http.NewRequest(http.MethodConnect, "http://runtime.invalid/extension", nil)
	// CONNECT uses an authority by default. This private endpoint uses one fixed path.
	request.URL.Opaque = "/extension"
	request.Header.Set("X-Browser-Source", target)
	request.Header.Set("X-Browser-Tab", tab)
	if err = request.Write(conn); err != nil {
		return nil, err
	}
	reader := bufio.NewReader(conn)
	response, err := http.ReadResponse(reader, request)
	if err != nil {
		return nil, err
	}
	if response.StatusCode != http.StatusOK {
		return nil, errors.New("extension source unavailable")
	}
	// The caller owns only admission. Once the handshake succeeds, cancellation
	// must no longer close a carrier shared by other viewers of this source.
	stopCancellation()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	_ = conn.SetDeadline(time.Time{})
	lifetime, cancel := context.WithCancel(host.ctx)
	pipe := &extensionSourcePipe{client: client, conn: conn, binding: binding, tab: tab, target: target, request: browserTraceRequest(ctx), ctx: lifetime, cancel: cancel, queue: make(chan json.RawMessage, 128), slots: make(chan struct{}, 32)}
	client.mu.Lock()
	if client.sources == nil {
		client.sources = make(map[string]*extensionSourcePipe)
	}
	if client.sources[binding] != nil {
		client.mu.Unlock()
		cancel()
		return nil, errors.New("extension source already attached")
	}
	client.sources[binding] = pipe
	client.mu.Unlock()
	context.AfterFunc(lifetime, pipe.close)
	success = true
	go pipe.write()
	go pipe.read(reader)
	return pipe, nil
}
func (pipe *extensionSourcePipe) enqueue(raw json.RawMessage) bool {
	if pipe.ctx.Err() != nil {
		return false
	}
	size := int64(len(raw))
	if pipe.bytes.Add(size) > 64<<20 {
		pipe.bytes.Add(-size)
		pipe.retire("source_queue_limit")
		return false
	}
	select {
	case pipe.queue <- raw:
		return true
	default:
		pipe.bytes.Add(-size)
		pipe.retire("source_queue_limit")
		return false
	}
}
func (pipe *extensionSourcePipe) write() {
	defer pipe.close()
	for {
		select {
		case <-pipe.ctx.Done():
			return
		case raw := <-pipe.queue:
			_ = pipe.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			err := browserbridge.WriteMessage(pipe.conn, raw, browserbridge.MaxMessageBytes)
			pipe.bytes.Add(-int64(len(raw)))
			if err != nil {
				pipe.retire("source_write_failed")
				return
			}
		}
	}
}
func (pipe *extensionSourcePipe) read(reader *bufio.Reader) {
	defer pipe.close()
	for {
		raw, err := browserbridge.ReadMessage(reader, 1<<20)
		if err != nil {
			pipe.retire("source_read_ended")
			return
		}
		var message struct {
			ID      string          `json:"id"`
			Method  string          `json:"method"`
			Params  json.RawMessage `json:"params"`
			Session string          `json:"session"`
			Ack     uint64          `json:"ack"`
		}
		if json.Unmarshal(raw, &message) != nil {
			return
		}
		if message.Ack != 0 {
			if pipe.client.write(map[string]any{"type": "cdp_ack", "sequence": message.Ack}) != nil {
				return
			}
			continue
		}
		if message.ID == "" || len(message.ID) > 64 || len(message.Method) > 128 || len(message.Session) > 256 {
			return
		}
		select {
		case pipe.slots <- struct{}{}:
		default:
			pipe.retire("source_command_limit")
			return
		}
		go func() {
			defer func() { <-pipe.slots }()
			started := time.Now()
			fields := []any{"stage", "cdp_method", "target_id", pipe.target, "binding", pipe.binding, "request", pipe.request, "command", message.ID, "method", message.Method, "child_frame", message.Session != ""}
			slog.Debug("browser source trace", append(fields, "phase", "started")...)
			result, err := pipe.client.call(pipe.ctx, "cdp", map[string]any{"binding": pipe.binding, "tab_id": pipe.tab, "session": message.Session, "method": message.Method, "params": message.Params})
			var reply map[string]any
			if err == nil {
				err = json.Unmarshal(result, &reply)
			}
			outcome := "completed"
			if err != nil || reply["error"] != nil {
				outcome = "failed"
			}
			slog.Debug("browser source trace", append(fields, "phase", outcome, "duration_ms", time.Since(started).Milliseconds())...)
			if reply == nil {
				reply = make(map[string]any)
			}
			reply["id"] = message.ID
			if err != nil {
				reply = map[string]any{"id": message.ID, "error": "extension command failed"}
			}
			payload, _ := json.Marshal(reply)
			pipe.enqueue(payload)
		}()
	}
}
func (pipe *extensionSourcePipe) close() { pipe.retire("") }

func (pipe *extensionSourcePipe) retire(reason string) {
	if pipe == nil {
		return
	}
	pipe.once.Do(func() {
		pipe.retired = make(chan struct{})
		if reason != "" {
			slog.Warn("browser source transport retired", "stage", "extension_carrier", "binding", pipe.binding, "reason", reason)
		}
		pipe.cancel()
		_ = pipe.conn.Close()
		// Detach only this exact generation. A reconnect must not inherit authority,
		// and a late cleanup cannot unbind a later explicit selection of the tab.
		go func() {
			defer close(pipe.retired)
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			_, pipe.retireError = pipe.client.call(ctx, "unbind", map[string]string{"tab_id": pipe.tab, "binding": pipe.binding})
			pipe.client.mu.Lock()
			if pipe.client.sources[pipe.binding] == pipe {
				delete(pipe.client.sources, pipe.binding)
			}
			pipe.client.mu.Unlock()
		}()
	})
}

func (pipe *extensionSourcePipe) drain(ctx context.Context) error {
	if pipe == nil {
		return nil
	}
	pipe.close()
	if pipe.retired == nil {
		return nil
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-pipe.retired:
		select {
		case <-pipe.client.done:
			return nil
		default:
		}
		return pipe.retireError
	}
}
