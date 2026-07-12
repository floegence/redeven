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

type SessionLifecycleEvent struct {
	Reason        string           `json:"reason"`
	SessionID     string           `json:"session_id"`
	Lifecycle     SessionLifecycle `json:"lifecycle"`
	OwnerWidgetID string           `json:"owner_widget_id,omitempty"`
	Hidden        bool             `json:"hidden,omitempty"`
	TimestampMs   int64            `json:"timestamp_ms"`
}

type SessionLifecycleHook func(SessionLifecycleEvent)

type sessionDeleteOperation struct {
	done         chan struct{}
	err          error
	participants int
}

func (r SessionLifecycleRecord) hiddenFromUI() bool {
	return r.Lifecycle == SessionLifecycleClosing || r.Lifecycle == SessionLifecycleCloseFailedHidden
}

func (m *Manager) AddSessionLifecycleHook(hook SessionLifecycleHook) func() {
	if m == nil || hook == nil {
		return func() {}
	}

	m.mu.Lock()
	if m.lifecycleHooks == nil {
		m.lifecycleHooks = make(map[int]SessionLifecycleHook)
	}
	m.nextLifecycleID++
	id := m.nextLifecycleID
	m.lifecycleHooks[id] = hook
	m.mu.Unlock()

	return func() {
		m.mu.Lock()
		delete(m.lifecycleHooks, id)
		m.mu.Unlock()
	}
}

func (m *Manager) emitSessionLifecycleEvent(event SessionLifecycleEvent) {
	if m == nil || strings.TrimSpace(event.SessionID) == "" {
		return
	}

	var hooks []SessionLifecycleHook
	m.mu.Lock()
	if len(m.lifecycleHooks) > 0 {
		hooks = make([]SessionLifecycleHook, 0, len(m.lifecycleHooks))
		for _, hook := range m.lifecycleHooks {
			if hook != nil {
				hooks = append(hooks, hook)
			}
		}
	}
	m.mu.Unlock()

	for _, hook := range hooks {
		func() {
			defer func() {
				if recovered := recover(); recovered != nil && m.log != nil {
					m.log.Error("terminal lifecycle hook panic", "panic", recovered)
				}
			}()
			hook(event)
		}()
	}
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

func (m *Manager) VisibleSessionIDs() []string {
	infos := m.visibleSessionInfos()
	out := make([]string, 0, len(infos))
	for _, info := range infos {
		sessionID := strings.TrimSpace(info.ID)
		if sessionID == "" {
			continue
		}
		out = append(out, sessionID)
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
	if m.term == nil {
		return &rpc.Error{Code: 500, Message: "internal error"}
	}
	_, sessionExists := m.term.GetSession(sessionID)

	m.mu.Lock()
	if operation := m.deleteOperations[sessionID]; operation != nil {
		operation.participants++
		m.mu.Unlock()
		<-operation.done
		return operation.err
	}
	record := m.sessionLifecycle[sessionID]
	if !sessionExists {
		if strict {
			m.mu.Unlock()
			return ErrSessionNotFound
		}
		delete(m.sessionLifecycle, sessionID)
		m.mu.Unlock()
		return nil
	}
	record.Lifecycle = SessionLifecycleClosing
	record.OwnerWidgetID = strings.TrimSpace(widgetID)
	record.CloseRequestedAtMs = nowUnixMs
	record.CloseFinishedAtMs = 0
	record.FailureCode = ""
	record.FailureMessage = ""
	m.sessionLifecycle[sessionID] = record
	operation := &sessionDeleteOperation{done: make(chan struct{}), participants: 1}
	if m.deleteOperations == nil {
		m.deleteOperations = make(map[string]*sessionDeleteOperation)
	}
	m.deleteOperations[sessionID] = operation
	m.mu.Unlock()

	payload := buildTerminalSessionsChangedPayload("closing", sessionID, record)
	m.broadcastSessionsChanged(payload)
	m.emitSessionLifecycleEvent(sessionLifecycleEventFromPayload(payload))

	go m.runAsyncDeleteSession(sessionID, operation)
	<-operation.done
	return operation.err
}

func (m *Manager) runAsyncDeleteSession(sessionID string, operation *sessionDeleteOperation) {
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
	err := deleteFn(sessionID)
	if err != nil {
		if _, exists := m.term.GetSession(sessionID); !exists {
			err = nil
		} else {
			m.markSessionDeleteFailure(sessionID, "DELETE_FAILED", err.Error())
		}
	}
	m.completeSessionDelete(sessionID, operation, err)
}

func (m *Manager) completeSessionDelete(sessionID string, operation *sessionDeleteOperation, err error) {
	if m == nil || operation == nil {
		return
	}
	m.mu.Lock()
	operation.err = err
	if m.deleteOperations[sessionID] == operation {
		delete(m.deleteOperations, sessionID)
	}
	close(operation.done)
	m.mu.Unlock()
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
	record.Lifecycle = SessionLifecycleOpen
	record.CloseFinishedAtMs = nowUnixMs
	record.FailureCode = strings.TrimSpace(failureCode)
	record.FailureMessage = strings.TrimSpace(failureMessage)
	m.sessionLifecycle[sessionID] = record
	m.mu.Unlock()

	payload := buildTerminalSessionsChangedPayload("close_failed", sessionID, record)
	m.broadcastSessionsChanged(payload)
	m.emitSessionLifecycleEvent(sessionLifecycleEventFromPayload(payload))
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

func sessionLifecycleEventFromPayload(payload terminalSessionsChangedPayload) SessionLifecycleEvent {
	return SessionLifecycleEvent{
		Reason:        strings.TrimSpace(payload.Reason),
		SessionID:     strings.TrimSpace(payload.SessionID),
		Lifecycle:     SessionLifecycle(strings.TrimSpace(payload.Lifecycle)),
		OwnerWidgetID: strings.TrimSpace(payload.OwnerWidgetID),
		Hidden:        payload.Hidden,
		TimestampMs:   payload.TimestampMs,
	}
}
