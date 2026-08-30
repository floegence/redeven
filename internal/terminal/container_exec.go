package terminal

import (
	"errors"
	"strings"
	"time"

	termgo "github.com/floegence/floeterm/terminal-go"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionrpc"
)

type ContainerExecSessionRequest struct {
	Name        string
	Executable  string
	Args        []string
	OwnerUserID string
}

type containerExecSession struct {
	ownerUserID string
	attachments int
	timer       *time.Timer
}

func (m *Manager) CreateContainerExecSession(req ContainerExecSessionRequest) (*SessionInfo, error) {
	if m == nil || m.term == nil {
		return nil, errors.New("terminal manager is unavailable")
	}
	ownerUserID := strings.TrimSpace(req.OwnerUserID)
	if ownerUserID == "" {
		return nil, errors.New("container Exec session owner is required")
	}

	m.groupOperationMu.Lock()
	defer m.groupOperationMu.Unlock()

	m.mu.Lock()
	admit := m.workloadAdmission
	m.mu.Unlock()
	release := func() {}
	if admit != nil {
		var err error
		release, err = admit()
		if err != nil {
			return nil, &sessionrpc.Error{Code: 409, Message: "Runtime workload admission failed"}
		}
		if release == nil {
			release = func() {}
		}
	}

	program := termgo.Program{Executable: req.Executable, Args: append([]string(nil), req.Args...)}
	sess, err := m.term.CreateProgramSession(strings.TrimSpace(req.Name), m.agentHomeAbs, program)
	if err != nil {
		release()
		m.log.Warn("container Exec session create failed", "executable", programName(program.Executable), "error", err)
		return nil, errors.New("failed to create container Exec session")
	}
	info := sess.ToSessionInfo()
	sessionID := strings.TrimSpace(info.ID)
	if sessionID == "" {
		release()
		_ = sess.Close()
		return nil, errors.New("container Exec session identity is unavailable")
	}

	record := &containerExecSession{ownerUserID: ownerUserID}
	timeout := m.containerExecInitialTimeout
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	record.timer = time.AfterFunc(timeout, func() {
		m.expireContainerExecSession(sessionID)
	})
	m.mu.Lock()
	m.containerExecSessions[sessionID] = record
	m.workloadReleases[sessionID] = release
	m.mu.Unlock()
	if _, ok := m.term.GetSession(sessionID); !ok {
		m.finalizeContainerExecSession(sessionID)
		return nil, errors.New("container Exec session exited before connection")
	}

	return toSessionInfo(info, "", ""), nil
}

func (m *Manager) DeleteContainerExecSession(sessionID string, ownerUserID string) error {
	return m.deleteContainerExecSession(sessionID, ownerUserID, true)
}

func (m *Manager) deleteContainerExecSession(sessionID string, ownerUserID string, enforceOwner bool) error {
	if m == nil || m.term == nil {
		return ErrSessionNotFound
	}
	sessionID = strings.TrimSpace(sessionID)
	ownerUserID = strings.TrimSpace(ownerUserID)
	if sessionID == "" {
		return ErrSessionNotFound
	}
	m.mu.Lock()
	record := m.containerExecSessions[sessionID]
	if record == nil || (enforceOwner && record.ownerUserID != ownerUserID) {
		m.mu.Unlock()
		return ErrSessionNotFound
	}
	if record.timer != nil {
		record.timer.Stop()
		record.timer = nil
	}
	m.mu.Unlock()
	if err := m.term.DeleteSession(sessionID); err != nil {
		if _, exists := m.term.GetSession(sessionID); exists {
			return err
		}
		m.finalizeContainerExecSession(sessionID)
	}
	return nil
}

func (m *Manager) expireContainerExecSession(sessionID string) {
	_ = m.deleteContainerExecSession(sessionID, "", false)
}

func (m *Manager) isContainerExecSession(sessionID string) bool {
	if m == nil {
		return false
	}
	m.mu.Lock()
	_, ok := m.containerExecSessions[strings.TrimSpace(sessionID)]
	m.mu.Unlock()
	return ok
}

func (m *Manager) authorizeSessionInteraction(meta *session.Meta, sessionID string) (bool, error) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" || m == nil || m.term == nil {
		return false, ErrSessionNotFound
	}
	m.mu.Lock()
	record := m.containerExecSessions[sessionID]
	m.mu.Unlock()
	if record == nil {
		if err := requireProcessLaunchPermission(meta); err != nil {
			return false, err
		}
		if !m.sessionAvailableForInteraction(sessionID) {
			return false, ErrSessionNotFound
		}
		return false, nil
	}
	if meta == nil || !meta.CanRead || !meta.CanExecute || strings.TrimSpace(meta.UserPublicID) != record.ownerUserID {
		return true, &sessionrpc.Error{Code: 403, Message: "container Exec requires read and execute permissions"}
	}
	if !m.sessionAvailableForInteraction(sessionID) {
		return true, ErrSessionNotFound
	}
	return true, nil
}

func (m *Manager) markContainerExecAttached(sessionID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	record := m.containerExecSessions[strings.TrimSpace(sessionID)]
	if record == nil {
		return false
	}
	if record.timer != nil {
		record.timer.Stop()
		record.timer = nil
	}
	record.attachments++
	return true
}

func (m *Manager) markContainerExecDetached(sessionID string) {
	m.mu.Lock()
	record := m.containerExecSessions[strings.TrimSpace(sessionID)]
	if record == nil {
		m.mu.Unlock()
		return
	}
	if record.attachments > 0 {
		record.attachments--
	}
	if record.attachments > 0 || record.timer != nil {
		m.mu.Unlock()
		return
	}
	timeout := m.containerExecReconnectTimeout
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	record.timer = time.AfterFunc(timeout, func() {
		m.expireContainerExecSession(sessionID)
	})
	m.mu.Unlock()
}

func (m *Manager) finalizeContainerExecSession(sessionID string) bool {
	if m == nil {
		return false
	}
	sessionID = strings.TrimSpace(sessionID)
	m.mu.Lock()
	record := m.containerExecSessions[sessionID]
	if record == nil {
		m.mu.Unlock()
		return false
	}
	if record.timer != nil {
		record.timer.Stop()
	}
	delete(m.containerExecSessions, sessionID)
	release := m.workloadReleases[sessionID]
	delete(m.workloadReleases, sessionID)
	delete(m.sessionLifecycle, sessionID)
	delete(m.localPathCapabilities, sessionID)
	delete(m.sessionGroupIDs, sessionID)
	m.mu.Unlock()
	if release != nil {
		release()
	}
	return true
}

func programName(executable string) string {
	value := strings.TrimSpace(executable)
	if index := strings.LastIndexAny(value, `/\\`); index >= 0 {
		value = value[index+1:]
	}
	return value
}
