package hostapps

import (
	"encoding/json"
	"io"
	"os/exec"
	"sync"
	"time"
)

// ScreenCaptureKit must have one process owner for this Runtime. In particular,
// an idle helper that has stopped capture can contend with a second helper's
// replayd connection. Application state remains isolated by an opaque channel.
type macHost struct {
	mu      sync.Mutex
	writeMu sync.Mutex
	cmd     *exec.Cmd
	input   io.WriteCloser
	clients map[string]*macHostClient
	done    chan struct{}
}

type macHostClient struct {
	host     *macHost
	id       string
	messages chan []byte
	done     chan struct{}
	pending  []byte // Owned by the single response reader.
}

func (m *Manager) openMacClient() (*macHostClient, error) {
	m.nativeMu.Lock()
	defer m.nativeMu.Unlock()
	m.mu.Lock()
	closed := m.closed
	m.mu.Unlock()
	if closed {
		return nil, ErrUnavailable
	}
	h := m.nativeHost
	if h != nil {
		select {
		case <-h.done:
			h = nil
		default:
		}
	}
	if h == nil {
		cmd, input, output, err := macCommand(m.macHelper())
		if err != nil {
			return nil, err
		}
		h = &macHost{cmd: cmd, input: input, clients: make(map[string]*macHostClient), done: make(chan struct{})}
		m.nativeHost = h
		go h.read(output)
	}
	c := &macHostClient{host: h, id: randomID(), messages: make(chan []byte, 128), done: make(chan struct{})}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.clients == nil {
		return nil, ErrUnavailable
	}
	h.clients[c.id] = c
	return c, nil
}

func (h *macHost) send(id string, request map[string]any) error {
	h.writeMu.Lock()
	defer h.writeMu.Unlock()
	h.mu.Lock()
	active := h.clients[id] != nil
	h.mu.Unlock()
	if !active && request["action"] != "detach" {
		return io.ErrClosedPipe
	}
	request["session_id"] = id
	return macSend(h.input, request)
}

func (h *macHost) read(output io.ReadCloser) {
	defer func() {
		_ = output.Close()
		_ = h.input.Close()
		_ = h.cmd.Process.Kill()
		_ = h.cmd.Wait()
		h.mu.Lock()
		for _, c := range h.clients {
			close(c.done)
		}
		h.clients = nil
		close(h.done)
		h.mu.Unlock()
	}()
	scanner := macScanner(output)
	for scanner.Scan() {
		raw := scanner.Bytes()
		var message struct {
			SessionID string `json:"session_id"`
		}
		if json.Unmarshal(raw, &message) != nil || message.SessionID == "" {
			return
		}
		h.mu.Lock()
		c := h.clients[message.SessionID]
		h.mu.Unlock()
		if c == nil {
			continue
		}
		packet := append(append([]byte(nil), raw...), '\n')
		select {
		case c.messages <- packet:
		case <-c.done:
		default:
			// A stalled consumer cannot block pictures or controls for other apps.
			// Closing its channel revokes only that application's sharing session.
			if h.remove(c) {
				go func() { _ = h.send(c.id, map[string]any{"action": "detach"}) }()
			}
		}
	}
}

func (h *macHost) remove(c *macHostClient) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.clients[c.id] != c {
		return false
	}
	delete(h.clients, c.id)
	close(c.done)
	return true
}

func (c *macHostClient) Write(data []byte) (int, error) {
	select {
	case <-c.done:
		return 0, io.ErrClosedPipe
	default:
	}
	var request map[string]any
	if err := json.Unmarshal(data, &request); err != nil {
		return 0, err
	}
	if err := c.host.send(c.id, request); err != nil {
		return 0, err
	}
	return len(data), nil
}

func (c *macHostClient) Read(data []byte) (int, error) {
	select {
	case <-c.done:
		return 0, io.EOF
	default:
	}
	if len(c.pending) == 0 {
		select {
		case c.pending = <-c.messages:
		case <-c.done:
			return 0, io.EOF
		}
	}
	n := copy(data, c.pending)
	c.pending = c.pending[n:]
	return n, nil
}

func (c *macHostClient) Close() error {
	if !c.host.remove(c) {
		return nil
	}
	return c.host.send(c.id, map[string]any{"action": "detach"})
}

func (m *Manager) closeMacHost() {
	m.nativeMu.Lock()
	h := m.nativeHost
	m.nativeHost = nil
	m.nativeMu.Unlock()
	if h == nil {
		return
	}
	_ = h.input.Close()
	select {
	case <-h.done:
	case <-time.After(2 * time.Second):
		_ = h.cmd.Process.Kill()
		<-h.done
	}
}
