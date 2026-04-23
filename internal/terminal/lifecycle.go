package terminal

import (
	"strings"
	"time"

	termgo "github.com/floegence/floeterm/terminal-go"
	"github.com/floegence/flowersec/flowersec-go/rpc"
)

type SessionLifecycle string

const (
	SessionLifecycleOpen              SessionLifecycle = "open"
	SessionLifecycleClosing           SessionLifecycle = "closing"
	SessionLifecycleClosed            SessionLifecycle = "closed"
	SessionLifecycleCloseFailedHidden SessionLifecycle = "close_failed_hidden"
)

type SessionLifecycleRecord struct {
	Lifecycle          SessionLifecycle `json:"lifecycle"`
	OwnerWidgetID      string           `json:"owner_widget_id,omitempty"`
	CloseRequestedAtMs int64            `json:"close_requested_at_ms,omitempty"`
	CloseFinishedAtMs  int64            `json:"close_finished_at_ms,omitempty"`
	FailureCode        string           `json:"failure_code,omitempty"`
	FailureMessage     string           `json:"failure_message,omitempty"`
}

func (r SessionLifecycleRecord) hiddenFromUI() bool {
	return r.Lifecycle == SessionLifecycleClosing || r.Lifecycle == SessionLifecycleCloseFailedHidden
}

func (m *Manager) trackSessionOpen(sessionID string) {
	if m == nil {
		return
	}
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return
	}

	m.mu.Lock()
	m.sessionLifecycle[sessionID] = SessionLifecycleRecord{Lifecycle: SessionLifecycleOpen}
	m.mu.Unlock()
}

func (m *Manager) visibleSessionInfos() []termgo.TerminalSessionInfo {
	if m == nil || m.term == nil {
		return nil
	}

	sessions := m.term.ListSessions()
	out := make([]termgo.TerminalSessionInfo, 0, len(sessions))
	for _, info := range sessions {
		if info == nil {
			continue
		}
		if m.sessionHidden(info.ID) {
			continue
		}
		out = append(out, info.ToSessionInfo())
	}
	return out
}

func (m *Manager) sessionHidden(sessionID string) bool {
	if m == nil {
		return false
	}
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return false
	}

	m.mu.Lock()
	record, ok := m.sessionLifecycle[sessionID]
	m.mu.Unlock()
	return ok && record.hiddenFromUI()
}

func (m *Manager) sessionAvailableForInteraction(sessionID string) bool {
	return !m.sessionHidden(sessionID)
}

func (m *Manager) lifecycleRecord(sessionID string) (SessionLifecycleRecord, bool) {
	if m == nil {
		return SessionLifecycleRecord{}, false
	}
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return SessionLifecycleRecord{}, false
	}
	m.mu.Lock()
	record, ok := m.sessionLifecycle[sessionID]
	m.mu.Unlock()
	return record, ok
}

func (m *Manager) deleteSessionNow(sessionID string) error {
	if m == nil || m.term == nil {
		return ErrSessionNotFound
	}
	return m.term.DeleteSession(sessionID)
}

func (m *Manager) DeleteSessionForWidget(sessionID string, widgetID string) error {
	return m.requestSessionDelete(sessionID, widgetID, false)
}

func (m *Manager) requestSessionDelete(sessionID string, widgetID string, strict bool) error {
	if m == nil {
		return &rpc.Error{Code: 500, Message: "internal error"}
	}
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return &rpc.Error{Code: 400, Message: "session_id is required"}
	}

	nowUnixMs := time.Now().UnixMilli()

	m.mu.Lock()
	record, ok := m.sessionLifecycle[sessionID]
	if ok && record.Lifecycle == SessionLifecycleClosing {
		m.mu.Unlock()
		return nil
	}
	m.mu.Unlock()

	if _, exists := m.term.GetSession(sessionID); !exists {
		if strict {
			return ErrSessionNotFound
		}
		m.mu.Lock()
		delete(m.sessionLifecycle, sessionID)
		m.mu.Unlock()
		return nil
	}

	m.mu.Lock()
	record = m.sessionLifecycle[sessionID]
	record.Lifecycle = SessionLifecycleClosing
	record.OwnerWidgetID = strings.TrimSpace(widgetID)
	record.CloseRequestedAtMs = nowUnixMs
	record.CloseFinishedAtMs = 0
	record.FailureCode = ""
	record.FailureMessage = ""
	m.sessionLifecycle[sessionID] = record
	m.mu.Unlock()

	m.broadcastSessionsChanged(buildTerminalSessionsChangedPayload("closing", sessionID, record))

	go m.runAsyncDeleteSession(sessionID)
	return nil
}

func (m *Manager) runAsyncDeleteSession(sessionID string) {
	if m == nil {
		return
	}
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return
	}

	m.detachSessionViewers(sessionID)

	deleteFn := m.deleteSessionFunc
	if deleteFn == nil {
		deleteFn = m.deleteSessionNow
	}
	if err := deleteFn(sessionID); err != nil {
		m.markSessionDeleteFailure(sessionID, "DELETE_FAILED", err.Error())
	}
}

func (m *Manager) markSessionDeleteFailure(sessionID string, failureCode string, failureMessage string) {
	if m == nil {
		return
	}
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return
	}

	nowUnixMs := time.Now().UnixMilli()

	m.mu.Lock()
	record, ok := m.sessionLifecycle[sessionID]
	if !ok {
		record = SessionLifecycleRecord{}
	}
	record.Lifecycle = SessionLifecycleCloseFailedHidden
	record.CloseFinishedAtMs = nowUnixMs
	record.FailureCode = strings.TrimSpace(failureCode)
	record.FailureMessage = strings.TrimSpace(failureMessage)
	m.sessionLifecycle[sessionID] = record
	m.mu.Unlock()

	m.broadcastSessionsChanged(buildTerminalSessionsChangedPayload("close_failed_hidden", sessionID, record))
}

func (m *Manager) finalizeSessionClosed(sessionID string) string {
	if m == nil {
		return "closed"
	}
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return "closed"
	}

	nowUnixMs := time.Now().UnixMilli()

	m.mu.Lock()
	record, ok := m.sessionLifecycle[sessionID]
	if !ok {
		m.mu.Unlock()
		return "closed"
	}

	reason := "closed"
	if record.Lifecycle == SessionLifecycleClosing {
		reason = "deleted"
	}
	record.Lifecycle = SessionLifecycleClosed
	record.CloseFinishedAtMs = nowUnixMs
	delete(m.sessionLifecycle, sessionID)
	m.mu.Unlock()

	return reason
}

func (m *Manager) detachSessionViewers(sessionID string) {
	if m == nil {
		return
	}
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return
	}

	var toRemove []sinkDetach

	m.mu.Lock()
	if servers := m.bySession[sessionID]; len(servers) > 0 {
		for srv, connID := range servers {
			toRemove = append(toRemove, sinkDetach{sessionID: sessionID, connID: connID})
			if sessions := m.byServer[srv]; sessions != nil {
				delete(sessions, sessionID)
				if len(sessions) == 0 {
					delete(m.byServer, srv)
				}
			}
		}
		delete(m.bySession, sessionID)
	}
	m.mu.Unlock()

	if len(toRemove) == 0 {
		return
	}

	sess, ok := m.term.GetSession(sessionID)
	if !ok || sess == nil {
		return
	}
	for _, item := range toRemove {
		sess.RemoveConnection(item.connID)
	}
}

func buildTerminalSessionsChangedPayload(
	reason string,
	sessionID string,
	record SessionLifecycleRecord,
) terminalSessionsChangedPayload {
	payload := terminalSessionsChangedPayload{
		Reason:      strings.TrimSpace(reason),
		SessionID:   strings.TrimSpace(sessionID),
		TimestampMs: time.Now().UnixMilli(),
	}
	if lifecycle := strings.TrimSpace(string(record.Lifecycle)); lifecycle != "" {
		payload.Lifecycle = lifecycle
		payload.Hidden = record.hiddenFromUI()
	}
	if widgetID := strings.TrimSpace(record.OwnerWidgetID); widgetID != "" {
		payload.OwnerWidgetID = widgetID
	}
	if code := strings.TrimSpace(record.FailureCode); code != "" {
		payload.FailureCode = code
	}
	if message := strings.TrimSpace(record.FailureMessage); message != "" {
		payload.FailureMessage = message
	}
	return payload
}
