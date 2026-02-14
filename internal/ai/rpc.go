package ai

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"

	"github.com/floegence/flowersec/flowersec-go/rpc"
	rpctyped "github.com/floegence/flowersec/flowersec-go/rpc/typed"
	"github.com/floegence/redeven-agent/internal/ai/threadstore"
	"github.com/floegence/redeven-agent/internal/session"
)

const (
	// Type IDs must stay in sync with
	// internal/envapp/ui_src/src/ui/protocol/redeven_v1/typeIds.ts.
	TypeID_AI_RUN_START           uint32 = 6001
	TypeID_AI_RUN_CANCEL          uint32 = 6002
	TypeID_AI_SUBSCRIBE           uint32 = 6003
	TypeID_AI_EVENT_NOTIFY        uint32 = 6004 // notify (agent -> client)
	TypeID_AI_TOOL_APPROVAL       uint32 = 6005
	TypeID_AI_MESSAGES_LIST       uint32 = 6006
	TypeID_AI_ACTIVE_RUN_SNAPSHOT uint32 = 6007
	TypeID_AI_SET_TOOL_COLLAPSED  uint32 = 6008
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

type aiListMessagesReq struct {
	ThreadID    string `json:"thread_id"`
	AfterRowID  int64  `json:"after_row_id,omitempty"`
	Tail        bool   `json:"tail,omitempty"`
	Limit       int    `json:"limit,omitempty"`
	IncludeBody bool   `json:"include_body,omitempty"`
}

type aiListMessagesResp struct {
	Messages       []aiTranscriptMessageItem `json:"messages"`
	NextAfterRowID int64                     `json:"next_after_row_id,omitempty"`
	HasMore        bool                      `json:"has_more,omitempty"`
}

type aiTranscriptMessageItem struct {
	RowID       int64           `json:"row_id"`
	MessageJSON json.RawMessage `json:"message_json"`
}

type aiToolApprovalReq struct {
	RunID    string `json:"run_id"`
	ToolID   string `json:"tool_id"`
	Approved bool   `json:"approved"`
}

type aiToolApprovalResp struct {
	OK bool `json:"ok"`
}

type aiGetActiveRunSnapshotReq struct {
	ThreadID string `json:"thread_id"`
}

type aiGetActiveRunSnapshotResp struct {
	OK          bool            `json:"ok"`
	RunID       string          `json:"run_id,omitempty"`
	MessageJSON json.RawMessage `json:"message_json,omitempty"`
}

type aiSetToolCollapsedReq struct {
	ThreadID  string `json:"thread_id"`
	MessageID string `json:"message_id"`
	ToolID    string `json:"tool_id"`
	Collapsed bool   `json:"collapsed"`
}

type aiSetToolCollapsedResp struct {
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
		if meta == nil || !meta.CanRead || !meta.CanWrite || !meta.CanExecute {
			return nil, &rpc.Error{Code: 403, Message: "read/write/execute permission denied"}
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

	rpctyped.Register[aiListMessagesReq, aiListMessagesResp](r, TypeID_AI_MESSAGES_LIST, func(ctx context.Context, req *aiListMessagesReq) (*aiListMessagesResp, error) {
		if meta == nil || !meta.CanRead || !meta.CanWrite || !meta.CanExecute {
			return nil, &rpc.Error{Code: 403, Message: "read/write/execute permission denied"}
		}
		if req == nil {
			return nil, &rpc.Error{Code: 400, Message: "invalid payload"}
		}
		threadID := strings.TrimSpace(req.ThreadID)
		if threadID == "" {
			return nil, &rpc.Error{Code: 400, Message: "missing thread_id"}
		}

		s.mu.Lock()
		db := s.threadsDB
		s.mu.Unlock()
		if db == nil {
			return nil, &rpc.Error{Code: 503, Message: "threads store not ready"}
		}

		// Ensure thread exists (consistent with other endpoints).
		if th, err := db.GetThread(ctx, strings.TrimSpace(meta.EndpointID), threadID); err != nil {
			return nil, &rpc.Error{Code: 400, Message: err.Error()}
		} else if th == nil {
			return nil, &rpc.Error{Code: 404, Message: "thread not found"}
		}

		limit := req.Limit
		if limit <= 0 {
			limit = 200
		}
		if limit > 500 {
			limit = 500
		}

		endpointID := strings.TrimSpace(meta.EndpointID)
		var msgs []threadstore.Message
		var nextAfter int64
		var hasMore bool

		if req.Tail {
			// Tail mode: return the latest messages window (ASC order) so the client can
			// anchor its cursor near the end even when realtime frames were dropped.
			var nextBefore int64
			var err error
			msgs, nextBefore, hasMore, err = db.ListMessages(ctx, endpointID, threadID, limit, 0)
			_ = nextBefore // not used by the RPC client yet
			if err != nil {
				return nil, &rpc.Error{Code: 400, Message: err.Error()}
			}
			if len(msgs) > 0 {
				nextAfter = msgs[len(msgs)-1].ID
			}
		} else {
			var err error
			msgs, nextAfter, hasMore, err = db.ListMessagesAfter(ctx, endpointID, threadID, limit, req.AfterRowID)
			if err != nil {
				return nil, &rpc.Error{Code: 400, Message: err.Error()}
			}
		}

		out := &aiListMessagesResp{
			Messages:       make([]aiTranscriptMessageItem, 0, len(msgs)),
			NextAfterRowID: nextAfter,
			HasMore:        hasMore,
		}
		for _, m := range msgs {
			raw := strings.TrimSpace(m.MessageJSON)
			if raw == "" {
				continue
			}
			out.Messages = append(out.Messages, aiTranscriptMessageItem{
				RowID:       m.ID,
				MessageJSON: json.RawMessage(raw),
			})
		}
		return out, nil
	})

	rpctyped.Register[aiGetActiveRunSnapshotReq, aiGetActiveRunSnapshotResp](r, TypeID_AI_ACTIVE_RUN_SNAPSHOT, func(ctx context.Context, req *aiGetActiveRunSnapshotReq) (*aiGetActiveRunSnapshotResp, error) {
		if meta == nil || !meta.CanRead || !meta.CanWrite || !meta.CanExecute {
			return nil, &rpc.Error{Code: 403, Message: "read/write/execute permission denied"}
		}
		if req == nil {
			return nil, &rpc.Error{Code: 400, Message: "invalid payload"}
		}
		threadID := strings.TrimSpace(req.ThreadID)
		if threadID == "" {
			return nil, &rpc.Error{Code: 400, Message: "missing thread_id"}
		}

		s.mu.Lock()
		db := s.threadsDB
		s.mu.Unlock()
		if db == nil {
			return nil, &rpc.Error{Code: 503, Message: "threads store not ready"}
		}

		// Ensure thread exists (consistent with other endpoints).
		if th, err := db.GetThread(ctx, strings.TrimSpace(meta.EndpointID), threadID); err != nil {
			return nil, &rpc.Error{Code: 400, Message: err.Error()}
		} else if th == nil {
			return nil, &rpc.Error{Code: 404, Message: "thread not found"}
		}

		runID, msgJSON, err := s.GetActiveRunSnapshot(meta, threadID)
		if err != nil {
			return nil, toAIRPCError(err)
		}
		if strings.TrimSpace(runID) == "" || strings.TrimSpace(msgJSON) == "" {
			return &aiGetActiveRunSnapshotResp{OK: false}, nil
		}
		return &aiGetActiveRunSnapshotResp{
			OK:          true,
			RunID:       runID,
			MessageJSON: json.RawMessage(strings.TrimSpace(msgJSON)),
		}, nil
	})

	rpctyped.Register[aiSetToolCollapsedReq, aiSetToolCollapsedResp](r, TypeID_AI_SET_TOOL_COLLAPSED, func(ctx context.Context, req *aiSetToolCollapsedReq) (*aiSetToolCollapsedResp, error) {
		if meta == nil || !meta.CanRead || !meta.CanWrite || !meta.CanExecute {
			return nil, &rpc.Error{Code: 403, Message: "read/write/execute permission denied"}
		}
		if req == nil {
			return nil, &rpc.Error{Code: 400, Message: "invalid payload"}
		}
		threadID := strings.TrimSpace(req.ThreadID)
		messageID := strings.TrimSpace(req.MessageID)
		toolID := strings.TrimSpace(req.ToolID)
		if threadID == "" {
			return nil, &rpc.Error{Code: 400, Message: "missing thread_id"}
		}
		if messageID == "" {
			return nil, &rpc.Error{Code: 400, Message: "missing message_id"}
		}
		if toolID == "" {
			return nil, &rpc.Error{Code: 400, Message: "missing tool_id"}
		}

		s.mu.Lock()
		db := s.threadsDB
		s.mu.Unlock()
		if db == nil {
			return nil, &rpc.Error{Code: 503, Message: "threads store not ready"}
		}

		// Ensure thread exists (consistent with other endpoints).
		if th, err := db.GetThread(ctx, strings.TrimSpace(meta.EndpointID), threadID); err != nil {
			return nil, &rpc.Error{Code: 400, Message: err.Error()}
		} else if th == nil {
			return nil, &rpc.Error{Code: 404, Message: "thread not found"}
		}

		if err := s.SetToolCollapsed(meta, threadID, messageID, toolID, req.Collapsed); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, &rpc.Error{Code: 404, Message: "message not found"}
			}
			return nil, toAIRPCError(err)
		}
		return &aiSetToolCollapsedResp{OK: true}, nil
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
