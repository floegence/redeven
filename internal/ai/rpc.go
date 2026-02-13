package ai

import (
	"context"
	"errors"
	"strings"

	"github.com/floegence/flowersec/flowersec-go/rpc"
	rpctyped "github.com/floegence/flowersec/flowersec-go/rpc/typed"
	"github.com/floegence/redeven-agent/internal/session"
)

const (
	// Type IDs must stay in sync with
	// internal/envapp/ui_src/src/ui/protocol/redeven_v1/typeIds.ts.
	TypeID_AI_RUN_START     uint32 = 6001
	TypeID_AI_RUN_CANCEL    uint32 = 6002
	TypeID_AI_SUBSCRIBE     uint32 = 6003
	TypeID_AI_EVENT_NOTIFY  uint32 = 6004 // notify (agent -> client)
	TypeID_AI_TOOL_APPROVAL uint32 = 6005
)

type aiRunStartReq struct {
	ThreadID string     `json:"thread_id"`
	Model    string     `json:"model,omitempty"`
	Input    RunInput   `json:"input"`
	Options  RunOptions `json:"options"`
}

type aiRunStartResp struct {
	RunID string `json:"run_id"`
}

type aiRunCancelReq struct {
	RunID    string `json:"run_id,omitempty"`
	ThreadID string `json:"thread_id,omitempty"`
}

type aiRunCancelResp struct {
	OK bool `json:"ok"`
}

type aiSubscribeReq struct{}

type aiSubscribeResp struct {
	ActiveRuns []ActiveThreadRun `json:"active_runs"`
}

type aiToolApprovalReq struct {
	RunID    string `json:"run_id"`
	ToolID   string `json:"tool_id"`
	Approved bool   `json:"approved"`
}

type aiToolApprovalResp struct {
	OK bool `json:"ok"`
}

func (s *Service) RegisterRPC(r *rpc.Router, meta *session.Meta, streamServer *rpc.Server) {
	if s == nil || r == nil {
		return
	}

	rpctyped.Register[aiRunStartReq, aiRunStartResp](r, TypeID_AI_RUN_START, func(_ context.Context, req *aiRunStartReq) (*aiRunStartResp, error) {
		if meta == nil || !meta.CanRead || !meta.CanWrite || !meta.CanExecute {
			return nil, &rpc.Error{Code: 403, Message: "read/write/execute permission denied"}
		}
		if !s.Enabled() {
			return nil, &rpc.Error{Code: 503, Message: "ai not configured"}
		}
		if req == nil {
			return nil, &rpc.Error{Code: 400, Message: "invalid payload"}
		}

		runID, err := NewRunID()
		if err != nil {
			return nil, &rpc.Error{Code: 500, Message: "failed to allocate run id"}
		}

		startReq := RunStartRequest{
			ThreadID: strings.TrimSpace(req.ThreadID),
			Model:    strings.TrimSpace(req.Model),
			Input:    req.Input,
			Options:  req.Options,
		}
		if err := s.StartRunDetached(meta, runID, startReq); err != nil {
			return nil, toAIRPCError(err)
		}
		return &aiRunStartResp{RunID: runID}, nil
	})

	rpctyped.Register[aiRunCancelReq, aiRunCancelResp](r, TypeID_AI_RUN_CANCEL, func(_ context.Context, req *aiRunCancelReq) (*aiRunCancelResp, error) {
		if meta == nil || !meta.CanRead || !meta.CanWrite || !meta.CanExecute {
			return nil, &rpc.Error{Code: 403, Message: "read/write/execute permission denied"}
		}
		if req == nil {
			return nil, &rpc.Error{Code: 400, Message: "invalid payload"}
		}

		runID := strings.TrimSpace(req.RunID)
		threadID := strings.TrimSpace(req.ThreadID)
		switch {
		case runID != "":
			if err := s.CancelRun(meta, runID); err != nil {
				return nil, toAIRPCError(err)
			}
		case threadID != "":
			if err := s.CancelThread(meta, threadID); err != nil {
				return nil, toAIRPCError(err)
			}
		default:
			return nil, &rpc.Error{Code: 400, Message: "run_id or thread_id is required"}
		}
		return &aiRunCancelResp{OK: true}, nil
	})

	rpctyped.Register[aiToolApprovalReq, aiToolApprovalResp](r, TypeID_AI_TOOL_APPROVAL, func(_ context.Context, req *aiToolApprovalReq) (*aiToolApprovalResp, error) {
		if meta == nil || !meta.CanRead || !meta.CanWrite || !meta.CanExecute {
			return nil, &rpc.Error{Code: 403, Message: "read/write/execute permission denied"}
		}
		if req == nil {
			return nil, &rpc.Error{Code: 400, Message: "invalid payload"}
		}
		if err := s.ApproveTool(meta, strings.TrimSpace(req.RunID), strings.TrimSpace(req.ToolID), req.Approved); err != nil {
			return nil, toAIRPCError(err)
		}
		return &aiToolApprovalResp{OK: true}, nil
	})

	rpctyped.Register[aiSubscribeReq, aiSubscribeResp](r, TypeID_AI_SUBSCRIBE, func(_ context.Context, _ *aiSubscribeReq) (*aiSubscribeResp, error) {
		if meta == nil || !meta.CanRead {
			return nil, &rpc.Error{Code: 403, Message: "read permission denied"}
		}
		if streamServer == nil {
			return nil, &rpc.Error{Code: 500, Message: "stream not ready"}
		}
		activeRuns, err := s.SubscribeEndpoint(strings.TrimSpace(meta.EndpointID), streamServer)
		if err != nil {
			return nil, toAIRPCError(err)
		}
		return &aiSubscribeResp{ActiveRuns: activeRuns}, nil
	})
}

func toAIRPCError(err error) *rpc.Error {
	if err == nil {
		return nil
	}
	msg := strings.TrimSpace(err.Error())
	if msg == "" {
		msg = "request failed"
	}

	switch {
	case errors.Is(err, ErrNotConfigured):
		return &rpc.Error{Code: 503, Message: "ai not configured"}
	case errors.Is(err, ErrRunActive), errors.Is(err, ErrThreadBusy):
		return &rpc.Error{Code: 409, Message: msg}
	}

	s := strings.ToLower(msg)
	switch {
	case strings.Contains(s, "thread not found"), strings.Contains(s, "run not found"):
		return &rpc.Error{Code: 404, Message: msg}
	case strings.Contains(s, "permission denied"):
		return &rpc.Error{Code: 403, Message: msg}
	default:
		return &rpc.Error{Code: 400, Message: msg}
	}
}
