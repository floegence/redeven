package ai

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
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
	client       *computerExtensionClient
	conn         net.Conn
	binding, tab string
	ctx          context.Context
	cancel       context.CancelFunc
	queue        chan json.RawMessage
	bytes        atomic.Int64
	slots        chan struct{}
	once         sync.Once
}

func (host *browserSourceHost) attachExtension(ctx context.Context, client *computerExtensionClient, target, tab, binding string) (*extensionSourcePipe, error) {
	conn, err := (&net.Dialer{}).DialContext(ctx, "unix", filepath.Join(host.directory, "host.sock"))
	if err != nil {
		return nil, err
	}
	success := false
	defer func() {
		if !success {
			_ = conn.Close()
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
	_ = conn.SetDeadline(time.Time{})
	lifetime, cancel := context.WithCancel(host.ctx)
	pipe := &extensionSourcePipe{client: client, conn: conn, binding: binding, tab: tab, ctx: lifetime, cancel: cancel, queue: make(chan json.RawMessage, 128), slots: make(chan struct{}, 32)}
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
		pipe.close()
		return false
	}
	select {
	case pipe.queue <- raw:
		return true
	default:
		pipe.bytes.Add(-size)
		pipe.close()
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
			return
		}
		go func() {
			defer func() { <-pipe.slots }()
			result, err := pipe.client.call(pipe.ctx, "cdp", map[string]any{"binding": pipe.binding, "tab_id": pipe.tab, "session": message.Session, "method": message.Method, "params": message.Params})
			var reply map[string]any
			if err == nil {
				err = json.Unmarshal(result, &reply)
			}
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
func (pipe *extensionSourcePipe) close() {
	if pipe == nil {
		return
	}
	pipe.once.Do(func() {
		pipe.cancel()
		_ = pipe.conn.Close()
		// Detach only this exact generation. A reconnect must not inherit authority,
		// and a late cleanup cannot unbind a later explicit selection of the tab.
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			_, _ = pipe.client.call(ctx, "unbind", map[string]string{"tab_id": pipe.tab, "binding": pipe.binding})
			pipe.client.mu.Lock()
			if pipe.client.sources[pipe.binding] == pipe {
				delete(pipe.client.sources, pipe.binding)
			}
			pipe.client.mu.Unlock()
		}()
	})
}
