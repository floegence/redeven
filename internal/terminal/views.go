package terminal

import (
	"context"
	"errors"

	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionrpc"
)

const (
	TypeID_TERMINAL_VIEW_LIST     uint32 = 2024
	TypeID_TERMINAL_VIEW_PUT      uint32 = 2025
	TypeID_TERMINAL_VIEW_DELETE   uint32 = 2026
	TypeID_TERMINAL_VIEWS_CHANGED uint32 = 2027
)

func (m *Manager) EnablePersistentViews(path string) error {
	catalog, err := openViewCatalog(path)
	if err != nil {
		return err
	}
	previous := m.viewCatalog
	m.viewCatalog = catalog
	return previous.Close()
}

type terminalViewPutReq struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	LayoutJSON   string `json:"layout_json"`
	BaseRevision uint64 `json:"base_revision"`
}
type terminalViewDeleteReq struct {
	ID           string `json:"id"`
	BaseRevision uint64 `json:"base_revision"`
}

func viewRPCError(err error) error {
	code := uint32(500)
	message := "terminal view operation failed"
	switch {
	case errors.Is(err, errInvalidView):
		code = 400
		message = err.Error()
	case errors.Is(err, errViewConflict):
		code = 409
		message = err.Error()
	case errors.Is(err, errViewNotFound):
		code = 404
		message = err.Error()
	}
	return &sessionrpc.Error{Code: code, Message: message}
}
func registerTerminalViewRPCs(m *Manager, r *sessionrpc.Router, meta *session.Meta, gate *accessgate.Gate) {
	accessgate.RegisterTyped[struct{}, TerminalViewSnapshot](r, TypeID_TERMINAL_VIEW_LIST, gate, meta, accessgate.RPCAccessProtected, func(context.Context, *struct{}) (*TerminalViewSnapshot, error) {
		if err := requireProcessLaunchPermission(meta); err != nil {
			return nil, err
		}
		snapshot := m.viewCatalog.Snapshot()
		return &snapshot, nil
	})
	accessgate.RegisterTyped[terminalViewPutReq, TerminalViewSnapshot](r, TypeID_TERMINAL_VIEW_PUT, gate, meta, accessgate.RPCAccessProtected, func(_ context.Context, req *terminalViewPutReq) (*TerminalViewSnapshot, error) {
		if err := requireProcessLaunchPermission(meta); err != nil {
			return nil, err
		}
		if req == nil {
			return nil, viewRPCError(errInvalidView)
		}
		if _, err := m.viewCatalog.Put(TerminalView{ID: req.ID, Name: req.Name, LayoutJSON: req.LayoutJSON}, req.BaseRevision); err != nil {
			return nil, viewRPCError(err)
		}
		snapshot := m.viewCatalog.Snapshot()
		m.broadcastTerminalMetadata(TypeID_TERMINAL_VIEWS_CHANGED, snapshot)
		return &snapshot, nil
	})
	accessgate.RegisterTyped[terminalViewDeleteReq, TerminalViewSnapshot](r, TypeID_TERMINAL_VIEW_DELETE, gate, meta, accessgate.RPCAccessProtected, func(_ context.Context, req *terminalViewDeleteReq) (*TerminalViewSnapshot, error) {
		if err := requireProcessLaunchPermission(meta); err != nil {
			return nil, err
		}
		if req == nil {
			return nil, viewRPCError(errInvalidView)
		}
		if err := m.viewCatalog.Delete(req.ID, req.BaseRevision); err != nil {
			return nil, viewRPCError(err)
		}
		snapshot := m.viewCatalog.Snapshot()
		m.broadcastTerminalMetadata(TypeID_TERMINAL_VIEWS_CHANGED, snapshot)
		return &snapshot, nil
	})
}
