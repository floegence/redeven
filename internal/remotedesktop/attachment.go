package remotedesktop

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"sync"
	"time"

	nativeapps "github.com/floegence/floe-native-apps"
	"github.com/gorilla/websocket"
)

type attachment struct {
	stateChanged   chan struct{}
	mu             sync.Mutex
	once           sync.Once
	closed         bool
	done           chan struct{}
	initialized    chan struct{}
	token          string
	expires        time.Time
	control, media *websocket.Conn
	native         Transport
	generation     uint64
	sequence       uint64
	painted        bool
	paintedFrame   uint64
	state          string
	sent           map[uint64]bool
}

// Replacement must not overlap a retired native input or portal grant lease.
// Initialization is separate from the run loop, which may be waiting for m.mu.
func (a *attachment) retire() error {
	a.close()
	timer := time.NewTimer(3 * time.Second)
	defer timer.Stop()
	if a.initialized != nil {
		select {
		case <-a.initialized:
		case <-timer.C:
			return ErrUnavailable
		}
	}
	a.mu.Lock()
	native := a.native
	a.mu.Unlock()
	if native != nil {
		select {
		case <-native.Done():
		case <-timer.C:
			return ErrUnavailable
		}
	}
	return nil
}

func (a *attachment) close() {
	a.once.Do(func() {
		a.mu.Lock()
		a.closed = true
		close(a.done)
		if a.control != nil {
			_ = a.control.Close()
		}
		if a.media != nil {
			_ = a.media.Close()
		}
		native := a.native
		a.mu.Unlock()
		if native != nil {
			_ = native.Close()
		}
	})
}
func (m *Manager) runAttachment(s *ownedSession, a *attachment) {
	defer func() {
		a.close()
		m.mu.Lock()
		defer m.mu.Unlock()
		if m.sessions[s.view.ID] == s && s.pair == a {
			s.expires = time.Now().Add(2 * time.Minute)
		}
	}()
	native, err := m.factory(context.Background())
	if err != nil {
		close(a.initialized)
		return
	}
	a.mu.Lock()
	a.native = native
	if a.closed {
		a.mu.Unlock()
		_ = native.Close()
		close(a.initialized)
		return
	}
	a.sent = map[uint64]bool{}
	a.stateChanged = make(chan struct{})
	a.mu.Unlock()
	close(a.initialized)
	m.mu.Lock()
	if s.pair == a {
		s.expires = time.Time{}
	}
	m.mu.Unlock()
	control, media := a.control, a.media
	for _, connection := range []*websocket.Conn{control, media} {
		connection.SetReadLimit(8 << 20)
		_ = connection.SetReadDeadline(time.Now().Add(45 * time.Second))
		connection.SetPongHandler(func(string) error { return connection.SetReadDeadline(time.Now().Add(45 * time.Second)) })
	}
	go func() {
		defer a.close()
		for {
			kind, _, err := media.ReadMessage()
			if err != nil || kind == websocket.TextMessage || kind == websocket.BinaryMessage {
				return
			}
		}
	}()
	go func() {
		defer a.close()
		for {
			kind, data, err := control.ReadMessage()
			if err != nil || kind != websocket.TextMessage {
				return
			}
			var request struct {
				Command  json.RawMessage `json:"command"`
				Takeover bool            `json:"takeover"`
			}
			decoder := json.NewDecoder(bytes.NewReader(data))
			decoder.DisallowUnknownFields()
			if decoder.Decode(&request) != nil || decoder.Decode(new(any)) != io.EOF {
				return
			}
			command, err := nativeapps.ParseHostDesktopCommand(request.Command)
			if err != nil {
				return
			}
			if err = m.send(s, a, command, request.Takeover); err != nil {
				return
			}
		}
	}()
	go func() {
		defer a.close()
		for {
			select {
			case <-a.done:
				return
			case <-native.Done():
				return
			case message := <-native.Media():
				if !a.awaitMediaState(message.Generation) {
					continue
				}
				a.mu.Lock()
				// State may advance after the wait resolves. Never record an old
				// frame ID in the successor generation's offered-frame set.
				if a.closed || message.Generation != a.generation || a.state != "active" && a.state != "locked" {
					a.mu.Unlock()
					continue
				}
				if message.Type == "frame" {
					a.sent[message.FrameID] = true
				}
				overflow := len(a.sent) > 4
				a.mu.Unlock()
				if overflow {
					return
				}
				var packet bytes.Buffer
				if nativeapps.WriteHostDesktopMessage(&packet, message) != nil {
					return
				}
				_ = media.SetWriteDeadline(time.Now().Add(5 * time.Second))
				if media.WriteMessage(websocket.BinaryMessage, packet.Bytes()) != nil {
					return
				}
			}
		}
	}()
	ping := time.NewTicker(15 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-a.done:
			return
		case <-native.Done():
			return
		case <-ping.C:
			for _, connection := range []*websocket.Conn{control, media} {
				if connection.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second)) != nil {
					return
				}
			}
		case message := <-native.Control():
			var selected string
			var saveDisplay func(string)
			if message.Type == "error" {
				m.mu.Lock()
				m.auditLocked(s, "failure", message.Code)
				m.mu.Unlock()
			}
			if message.Type == "state" {
				m.mu.Lock()
				a.mu.Lock()
				if message.Generation != a.generation || message.State != "active" {
					a.painted = false
					a.paintedFrame = 0
					a.sent = map[uint64]bool{}
				}
				if a.stateChanged != nil {
					close(a.stateChanged)
				}
				a.stateChanged = make(chan struct{})
				if a.state != message.State && message.State != "active" && message.State != "connecting" {
					m.auditLocked(s, "revoke", message.State)
				}
				a.generation = message.Generation
				a.state = message.State
				// An unbound adapter reports view while asking for OS access.
				// Only an established desktop can change the requested control lease.
				if message.State == "active" && (message.Mode == "view" || message.Mode == "control") {
					s.view.Mode = message.Mode
				}
				if message.State == "active" && message.DisplayID != "" && message.DisplayID != s.view.DisplayID {
					s.view.DisplayID = message.DisplayID
					selected, saveDisplay = message.DisplayID, m.displaySelected
				}
				if s.view.Mode == "view" && m.controller == s.view.ID {
					m.controller = ""
				}
				a.mu.Unlock()
				m.mu.Unlock()
			}
			if saveDisplay != nil {
				saveDisplay(selected)
			}
			_ = control.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if control.WriteJSON(message) != nil {
				return
			}
		}
	}
}

// The product and native adapter both enforce fresh frame and control ownership.
// Commands are never retained for a successor attachment or replayed on reconnect.
func (m *Manager) send(s *ownedSession, a *attachment, command nativeapps.HostDesktopCommand, takeover bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.sessions[s.view.ID] != s || s.pair != a {
		return ErrNotFound
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.closed || a.native == nil {
		return ErrUnavailable
	}
	switch command.Method {
	case "probe":
	case "connect":
		// Declining a native console takeover may release a reserved control
		// lease. A connect command can never escalate a view-only session.
		if command.Mode == "view" {
			s.view.Mode = "view"
			if m.controller == s.view.ID {
				m.controller = ""
			}
		}
		command.Mode = s.view.Mode
		command.Unattended = s.unattended
		takeover = takeover || s.takeover
		s.takeover = false
	case "set_mode":
		if command.Mode == "control" {
			if m.controller != "" && m.controller != s.view.ID && !takeover {
				return ErrControlInUse
			}
			if err := m.claimLocked(s); err != nil {
				return err
			}
		} else if m.controller == s.view.ID {
			m.controller = ""
		}
		s.view.Mode = command.Mode
		a.painted = false
	case "select_display", "configure", "keyframe":
		a.painted = false
	case "frame_ack":
		if command.Generation < a.generation {
			// A paint receipt already on the other socket can cross a display
			// transition. Ignore it without granting authority or reconnecting.
			return nil
		}
		if command.Generation != a.generation || !a.sent[command.FrameID] || a.state != "active" && a.state != "locked" {
			return ErrInvalid
		}
		for id := range a.sent {
			if id <= command.FrameID {
				delete(a.sent, id)
			}
		}
		a.painted = true
		a.paintedFrame = command.FrameID
	case "input", "get_clipboard", "set_clipboard", "lock":
		if s.view.Mode != "control" || m.controller != s.view.ID || !a.painted || a.state != "active" || command.Generation != a.generation {
			return ErrForbidden
		}
	case "unlock_input":
		if s.view.Mode != "control" || m.controller != s.view.ID || !a.painted || a.state != "locked" || command.Generation != a.generation || command.FrameID != a.paintedFrame {
			return ErrForbidden
		}
	case "unlock_cancel":
		if s.view.Mode != "control" || m.controller != s.view.ID || a.state != "locked" || command.Generation != a.generation {
			return ErrForbidden
		}
	case "set_clipboard_sync":
		if command.Enabled != nil && *command.Enabled && (s.view.Mode != "control" || m.controller != s.view.ID || !a.painted || a.state != "active") {
			return ErrForbidden
		}
	case "release_input":
	case "disconnect":
		return ErrNotFound
	default:
		return ErrInvalid
	}
	a.sequence++
	command.ID = a.sequence
	return a.native.Send(command, takeover)
}

// Change is used by owner-authorized product routes; generation is taken only
// from the currently attached native session, never from a previous connection.
func (m *Manager) Change(owner, id, method, value string, takeover bool) error {
	m.mu.Lock()
	s, err := m.ownedLocked(owner, id)
	if err != nil {
		m.mu.Unlock()
		return err
	}
	a := s.pair
	if a == nil {
		m.mu.Unlock()
		return ErrUnavailable
	}
	a.mu.Lock()
	generation := a.generation
	a.mu.Unlock()
	m.mu.Unlock()
	command := nativeapps.HostDesktopCommand{Version: 1, ID: 1, Method: method, Generation: generation}
	switch method {
	case "set_mode":
		command.Mode = value
	case "select_display":
		command.DisplayID = value
	}
	if !command.Valid() {
		return ErrInvalid
	}
	return m.send(s, a, command, takeover)
}

// Control and media pipes can arrive in either order. Hold a bounded native
// packet until its active state arrives instead of losing an unacknowledged key
// frame. A newer state retires it without granting input for the old display.
func (a *attachment) awaitMediaState(generation uint64) bool {
	for {
		a.mu.Lock()
		if a.closed || generation < a.generation {
			a.mu.Unlock()
			return false
		}
		if generation == a.generation && (a.state == "active" || a.state == "locked") {
			a.mu.Unlock()
			return true
		}
		if generation == a.generation && a.state != "connecting" && a.state != "locked" {
			a.mu.Unlock()
			return false
		}
		changed := a.stateChanged
		a.mu.Unlock()
		select {
		case <-a.done:
			return false
		case <-changed:
		}
	}
}
