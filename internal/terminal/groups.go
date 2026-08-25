package terminal

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionrpc"
)

type DeleteGroupResult struct {
	Revision         uint64   `json:"revision"`
	FailedSessionIDs []string `json:"failed_session_ids"`
}

func (m *Manager) EnablePersistentGroups(path string) error {
	if m == nil {
		return errors.New("nil terminal manager")
	}
	m.groupOperationMu.Lock()
	defer m.groupOperationMu.Unlock()
	if len(m.term.ListSessions()) != 0 {
		return errors.New("terminal group catalog must be configured before sessions are created")
	}
	catalog, err := openPersistentGroupCatalog(path, m.agentHomeAbs)
	if err != nil {
		return err
	}
	previous := m.groupCatalog
	m.groupCatalog = catalog
	if previous != nil {
		_ = previous.Close()
	}
	return nil
}

func (m *Manager) GroupCatalogSnapshot() GroupCatalogSnapshot {
	if m == nil || m.groupCatalog == nil {
		return GroupCatalogSnapshot{}
	}
	return m.groupCatalog.Snapshot()
}

func (m *Manager) CreateGroup(name string, defaultWorkingDir string) (GroupCatalogSnapshot, Group, error) {
	if m == nil || m.groupCatalog == nil {
		return GroupCatalogSnapshot{}, Group{}, errors.New("terminal group catalog is unavailable")
	}
	resolved, err := m.resolveGroupWorkingDir(defaultWorkingDir)
	if err != nil {
		return GroupCatalogSnapshot{}, Group{}, terminalGroupWorkingDirError(err)
	}
	m.groupOperationMu.Lock()
	snapshot, group, err := m.groupCatalog.Create(name, resolved)
	m.groupOperationMu.Unlock()
	if err != nil {
		return GroupCatalogSnapshot{}, Group{}, err
	}
	m.broadcastGroupCatalogChanged("created", group.ID, "", snapshot.Revision)
	return snapshot, group, nil
}

func (m *Manager) UpdateGroup(groupID string, name *string, defaultWorkingDir *string) (GroupCatalogSnapshot, Group, error) {
	if m == nil || m.groupCatalog == nil {
		return GroupCatalogSnapshot{}, Group{}, errors.New("terminal group catalog is unavailable")
	}
	if name == nil && defaultWorkingDir == nil {
		return GroupCatalogSnapshot{}, Group{}, errors.New("group update is empty")
	}
	var resolvedWorkingDir *string
	if defaultWorkingDir != nil {
		resolved, err := m.resolveGroupWorkingDir(*defaultWorkingDir)
		if err != nil {
			return GroupCatalogSnapshot{}, Group{}, terminalGroupWorkingDirError(err)
		}
		resolvedWorkingDir = &resolved
	}
	m.groupOperationMu.Lock()
	snapshot, group, err := m.groupCatalog.Update(strings.TrimSpace(groupID), name, resolvedWorkingDir)
	m.groupOperationMu.Unlock()
	if err != nil {
		return GroupCatalogSnapshot{}, Group{}, err
	}
	m.broadcastGroupCatalogChanged("updated", group.ID, "", snapshot.Revision)
	return snapshot, group, nil
}

func (m *Manager) MoveSessionToGroup(sessionID string, groupID string) (uint64, error) {
	if m == nil || m.groupCatalog == nil {
		return 0, errors.New("terminal group catalog is unavailable")
	}
	sessionID = strings.TrimSpace(sessionID)
	groupID = strings.TrimSpace(groupID)
	if sessionID == "" || groupID == "" {
		return 0, errors.New("session_id and group_id are required")
	}
	m.groupOperationMu.Lock()
	defer m.groupOperationMu.Unlock()
	if _, ok := m.groupCatalog.Group(groupID); !ok {
		return 0, ErrTerminalGroupNotFound
	}
	if _, ok := m.term.GetSession(sessionID); !ok || m.sessionHidden(sessionID) {
		return 0, ErrSessionNotFound
	}
	m.mu.Lock()
	currentGroupID := m.sessionGroupIDs[sessionID]
	_, deleting := m.deletingGroupIDs[groupID]
	m.mu.Unlock()
	if deleting {
		return 0, errors.New("terminal group is being deleted")
	}
	if currentGroupID == "" {
		return 0, errors.New("terminal session has no group assignment")
	}
	if currentGroupID == groupID {
		return m.groupCatalog.Snapshot().Revision, nil
	}
	revision, err := m.groupCatalog.AdvanceRevision()
	if err != nil {
		return 0, err
	}
	m.mu.Lock()
	m.sessionGroupIDs[sessionID] = groupID
	m.mu.Unlock()
	m.broadcastGroupCatalogChanged("session_moved", groupID, sessionID, revision)
	return revision, nil
}

func (m *Manager) DeleteGroup(groupID string) (DeleteGroupResult, error) {
	if m == nil || m.groupCatalog == nil {
		return DeleteGroupResult{}, errors.New("terminal group catalog is unavailable")
	}
	groupID = strings.TrimSpace(groupID)
	if groupID == DefaultTerminalGroupID {
		return DeleteGroupResult{}, ErrDefaultTerminalGroupLocked
	}
	m.groupOperationMu.Lock()
	defer m.groupOperationMu.Unlock()
	if _, ok := m.groupCatalog.Group(groupID); !ok {
		return DeleteGroupResult{}, ErrTerminalGroupNotFound
	}
	m.mu.Lock()
	m.deletingGroupIDs[groupID] = struct{}{}
	sessionIDs := make([]string, 0)
	for sessionID, assignedGroupID := range m.sessionGroupIDs {
		if assignedGroupID == groupID {
			sessionIDs = append(sessionIDs, sessionID)
		}
	}
	m.mu.Unlock()
	defer func() {
		m.mu.Lock()
		delete(m.deletingGroupIDs, groupID)
		m.mu.Unlock()
	}()

	failed := closeTerminalGroupSessions(sessionIDs, func(sessionID string) error {
		return m.requestSessionDelete(sessionID, "", false, true)
	})
	snapshot, err := m.groupCatalog.Delete(groupID)
	if err != nil {
		return DeleteGroupResult{}, err
	}
	m.broadcastGroupCatalogChanged("deleted", groupID, "", snapshot.Revision)
	return DeleteGroupResult{Revision: snapshot.Revision, FailedSessionIDs: failed}, nil
}

func closeTerminalGroupSessions(sessionIDs []string, closeSession func(string) error) []string {
	if len(sessionIDs) == 0 || closeSession == nil {
		return nil
	}
	const maxConcurrentCloses = 4
	semaphore := make(chan struct{}, maxConcurrentCloses)
	var wait sync.WaitGroup
	var mu sync.Mutex
	failed := make([]string, 0)
	for _, current := range sessionIDs {
		sessionID := current
		wait.Add(1)
		go func() {
			defer wait.Done()
			semaphore <- struct{}{}
			err := closeSession(sessionID)
			<-semaphore
			if err != nil {
				mu.Lock()
				failed = append(failed, sessionID)
				mu.Unlock()
			}
		}()
	}
	wait.Wait()
	sort.Strings(failed)
	return failed
}

func (m *Manager) sessionGroupID(sessionID string) string {
	if m == nil {
		return ""
	}
	m.mu.Lock()
	groupID := m.sessionGroupIDs[strings.TrimSpace(sessionID)]
	m.mu.Unlock()
	return groupID
}

func terminalGroupWorkingDirError(err error) error {
	switch {
	case errors.Is(err, ErrTerminalGroupNotFound):
		return err
	case errors.Is(err, context.Canceled):
		return err
	default:
		return fmt.Errorf("invalid group default working directory: %w", err)
	}
}

func (m *Manager) resolveGroupWorkingDir(workingDir string) (string, error) {
	workingDir = strings.TrimSpace(workingDir)
	if workingDir == "" {
		return "", errors.New("group default working directory is required")
	}
	if !filepath.IsAbs(workingDir) {
		return "", errors.New("group default working directory must be absolute")
	}
	return m.resolveWorkingDir(workingDir)
}

func (m *Manager) broadcastGroupCatalogChanged(reason string, groupID string, sessionID string, revision uint64) {
	m.broadcastTerminalMetadata(TypeID_TERMINAL_GROUP_CATALOG_CHANGED, terminalGroupCatalogChangedPayload{
		Reason:    strings.TrimSpace(reason),
		GroupID:   strings.TrimSpace(groupID),
		SessionID: strings.TrimSpace(sessionID),
		Revision:  revision,
	})
}

func registerTerminalGroupRPCs(m *Manager, r *sessionrpc.Router, meta *session.Meta, gate *accessgate.Gate) {
	accessgate.RegisterTyped[terminalGroupListReq, terminalGroupListResp](r, TypeID_TERMINAL_GROUP_LIST, gate, meta, accessgate.RPCAccessProtected, func(_ context.Context, _ *terminalGroupListReq) (*terminalGroupListResp, error) {
		if err := requireProcessLaunchPermission(meta); err != nil {
			return nil, err
		}
		snapshot := m.GroupCatalogSnapshot()
		return &terminalGroupListResp{Revision: snapshot.Revision, Groups: snapshot.Groups}, nil
	})
	accessgate.RegisterTyped[terminalGroupCreateReq, terminalGroupMutationResp](r, TypeID_TERMINAL_GROUP_CREATE, gate, meta, accessgate.RPCAccessProtected, func(_ context.Context, req *terminalGroupCreateReq) (*terminalGroupMutationResp, error) {
		if err := requireProcessLaunchPermission(meta); err != nil {
			return nil, err
		}
		if req == nil {
			return nil, &sessionrpc.Error{Code: 400, Message: "invalid payload"}
		}
		snapshot, group, err := m.CreateGroup(req.Name, req.DefaultWorkingDir)
		if err != nil {
			return nil, terminalGroupRPCError(err)
		}
		return &terminalGroupMutationResp{Revision: snapshot.Revision, Group: &group}, nil
	})
	accessgate.RegisterTyped[terminalGroupUpdateReq, terminalGroupMutationResp](r, TypeID_TERMINAL_GROUP_UPDATE, gate, meta, accessgate.RPCAccessProtected, func(_ context.Context, req *terminalGroupUpdateReq) (*terminalGroupMutationResp, error) {
		if err := requireProcessLaunchPermission(meta); err != nil {
			return nil, err
		}
		if req == nil {
			return nil, &sessionrpc.Error{Code: 400, Message: "invalid payload"}
		}
		snapshot, group, err := m.UpdateGroup(req.GroupID, req.Name, req.DefaultWorkingDir)
		if err != nil {
			return nil, terminalGroupRPCError(err)
		}
		return &terminalGroupMutationResp{Revision: snapshot.Revision, Group: &group}, nil
	})
	accessgate.RegisterTyped[terminalGroupDeleteReq, terminalGroupDeleteResp](r, TypeID_TERMINAL_GROUP_DELETE, gate, meta, accessgate.RPCAccessProtected, func(_ context.Context, req *terminalGroupDeleteReq) (*terminalGroupDeleteResp, error) {
		if err := requireProcessLaunchPermission(meta); err != nil {
			return nil, err
		}
		if req == nil {
			return nil, &sessionrpc.Error{Code: 400, Message: "invalid payload"}
		}
		result, err := m.DeleteGroup(req.GroupID)
		if err != nil {
			return nil, terminalGroupRPCError(err)
		}
		return &terminalGroupDeleteResp{Revision: result.Revision, FailedSessionIDs: result.FailedSessionIDs}, nil
	})
	accessgate.RegisterTyped[terminalSessionMoveReq, terminalSessionMoveResp](r, TypeID_TERMINAL_SESSION_MOVE, gate, meta, accessgate.RPCAccessProtected, func(_ context.Context, req *terminalSessionMoveReq) (*terminalSessionMoveResp, error) {
		if err := requireProcessLaunchPermission(meta); err != nil {
			return nil, err
		}
		if req == nil {
			return nil, &sessionrpc.Error{Code: 400, Message: "invalid payload"}
		}
		revision, err := m.MoveSessionToGroup(req.SessionID, req.GroupID)
		if err != nil {
			return nil, terminalGroupRPCError(err)
		}
		return &terminalSessionMoveResp{Revision: revision, SessionID: strings.TrimSpace(req.SessionID), GroupID: strings.TrimSpace(req.GroupID)}, nil
	})
}

func terminalGroupRPCError(err error) error {
	if err == nil {
		return nil
	}
	switch {
	case errors.Is(err, ErrTerminalGroupNotFound), errors.Is(err, ErrSessionNotFound):
		return &sessionrpc.Error{Code: 404, Message: err.Error()}
	case errors.Is(err, ErrTerminalGroupNameConflict), errors.Is(err, ErrDefaultTerminalGroupLocked):
		return &sessionrpc.Error{Code: 409, Message: err.Error()}
	case strings.Contains(err.Error(), "required"), strings.Contains(err.Error(), "at most"), strings.Contains(err.Error(), "working directory"), strings.Contains(err.Error(), "empty"):
		return &sessionrpc.Error{Code: 400, Message: err.Error()}
	default:
		return &sessionrpc.Error{Code: 500, Message: "terminal group operation failed"}
	}
}

type terminalGroupListReq struct{}

type terminalGroupListResp struct {
	Revision uint64  `json:"revision"`
	Groups   []Group `json:"groups"`
}

type terminalGroupCreateReq struct {
	Name              string `json:"name"`
	DefaultWorkingDir string `json:"default_working_dir"`
}

type terminalGroupUpdateReq struct {
	GroupID           string  `json:"group_id"`
	Name              *string `json:"name,omitempty"`
	DefaultWorkingDir *string `json:"default_working_dir,omitempty"`
}

type terminalGroupMutationResp struct {
	Revision uint64 `json:"revision"`
	Group    *Group `json:"group"`
}

type terminalGroupDeleteReq struct {
	GroupID string `json:"group_id"`
}

type terminalGroupDeleteResp struct {
	Revision         uint64   `json:"revision"`
	FailedSessionIDs []string `json:"failed_session_ids"`
}

type terminalSessionMoveReq struct {
	SessionID string `json:"session_id"`
	GroupID   string `json:"group_id"`
}

type terminalSessionMoveResp struct {
	Revision  uint64 `json:"revision"`
	SessionID string `json:"session_id"`
	GroupID   string `json:"group_id"`
}

type terminalGroupCatalogChangedPayload struct {
	Reason    string `json:"reason"`
	GroupID   string `json:"group_id,omitempty"`
	SessionID string `json:"session_id,omitempty"`
	Revision  uint64 `json:"revision"`
}
