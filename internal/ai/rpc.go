package ai

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/floegence/flowersec/flowersec-go/rpc"
	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/session"
)

const (
	// Type IDs must stay in sync with
	// internal/envapp/ui_src/src/ui/protocol/redeven_v1/typeIds.ts.
	TypeID_AI_SEND_USER_TURN                     uint32 = 6001
	TypeID_AI_SUBSCRIBE_SUMMARY                  uint32 = 6003
	TypeID_AI_EVENT_NOTIFY                       uint32 = 6004 // notify (agent -> client)
	TypeID_AI_MESSAGES_LIST                      uint32 = 6006
	TypeID_AI_SUBSCRIBE_THREAD                   uint32 = 6009
	TypeID_AI_STOP_THREAD                        uint32 = 6011
	TypeID_AI_SUBMIT_REQUEST_USER_INPUT_RESPONSE uint32 = 6012
	TypeID_AI_COMPACT_THREAD_CONTEXT             uint32 = 6013
)

type aiSendUserTurnReq struct {
	ThreadID              string     `json:"thread_id"`
	Model                 string     `json:"model,omitempty"`
	Input                 RunInput   `json:"input"`
	Options               RunOptions `json:"options"`
	ExpectedRunID         string     `json:"expected_run_id,omitempty"`
	QueueAfterWaitingUser bool       `json:"queue_after_waiting_user,omitempty"`
	SourceFollowupID      string     `json:"source_followup_id,omitempty"`
}

type aiSendUserTurnResp struct {
	RunID                   string `json:"run_id"`
	Kind                    string `json:"kind"`
	QueueID                 string `json:"queue_id,omitempty"`
	QueuePosition           int    `json:"queue_position,omitempty"`
	ConsumedWaitingPromptID string `json:"consumed_waiting_prompt_id,omitempty"`
	AppliedPermissionType   string `json:"applied_permission_type,omitempty"`
}

type aiSubmitRequestUserInputResponseReq struct {
	ThreadID         string                   `json:"thread_id"`
	Model            string                   `json:"model,omitempty"`
	Response         RequestUserInputResponse `json:"response"`
	Input            RunInput                 `json:"input"`
	Options          RunOptions               `json:"options"`
	ExpectedRunID    string                   `json:"expected_run_id,omitempty"`
	SourceFollowupID string                   `json:"source_followup_id,omitempty"`
}

type aiSubmitRequestUserInputResponseResp struct {
	RunID                   string `json:"run_id"`
	Kind                    string `json:"kind"`
	ConsumedWaitingPromptID string `json:"consumed_waiting_prompt_id,omitempty"`
	AppliedPermissionType   string `json:"applied_permission_type,omitempty"`
}

type aiCompactThreadContextReq struct {
	ThreadID      string `json:"thread_id"`
	ExpectedRunID string `json:"expected_run_id,omitempty"`
	Source        string `json:"source"`
}

type aiCompactThreadContextResp struct {
	OperationID string `json:"operation_id,omitempty"`
	Kind        string `json:"kind"`
	ErrorCode   string `json:"error_code,omitempty"`
}

type aiSubscribeSummaryReq struct{}

type aiSubscribeSummaryResp struct {
	ActiveRuns []ActiveThreadRun `json:"active_runs"`
}

type aiSubscribeThreadReq struct {
	ThreadID string `json:"thread_id"`
}

type aiSubscribeThreadResp struct {
	RunID string `json:"run_id,omitempty"`
}

type aiStopThreadReq struct {
	ThreadID string `json:"thread_id"`
}

type aiStopThreadResp struct {
	OK                 bool               `json:"ok"`
	RecoveredFollowups []FollowupItemView `json:"recovered_followups,omitempty"`
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

func (s *Service) RegisterRPC(r *rpc.Router, meta *session.Meta, streamServer *rpc.Server) {
	s.RegisterRPCWithAccessGate(r, meta, streamServer, nil)
}

func (s *Service) RegisterRPCWithAccessGate(r *rpc.Router, meta *session.Meta, streamServer *rpc.Server, gate *accessgate.Gate) {
	if s == nil || r == nil {
		return
	}

	accessgate.RegisterTyped[aiSendUserTurnReq, aiSendUserTurnResp](r, TypeID_AI_SEND_USER_TURN, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *aiSendUserTurnReq) (*aiSendUserTurnResp, error) {
		if meta == nil || !meta.CanRead || !meta.CanWrite || !meta.CanExecute {
			return nil, &rpc.Error{Code: 403, Message: "read/write/execute permission denied"}
		}
		if !s.Enabled() {
			return nil, &rpc.Error{Code: 503, Message: "ai not configured"}
		}
		if req == nil {
			return nil, &rpc.Error{Code: 400, Message: "invalid payload"}
		}
		resp, err := s.SendUserTurn(ctx, meta, SendUserTurnRequest{
			ThreadID:              strings.TrimSpace(req.ThreadID),
			Model:                 strings.TrimSpace(req.Model),
			Input:                 req.Input,
			Options:               req.Options,
			ExpectedRunID:         strings.TrimSpace(req.ExpectedRunID),
			QueueAfterWaitingUser: req.QueueAfterWaitingUser,
			SourceFollowupID:      strings.TrimSpace(req.SourceFollowupID),
		})
		if err != nil {
			return nil, toAIRPCError(err)
		}
		return &aiSendUserTurnResp{
			RunID:                   strings.TrimSpace(resp.RunID),
			Kind:                    strings.TrimSpace(resp.Kind),
			QueueID:                 strings.TrimSpace(resp.QueueID),
			QueuePosition:           resp.QueuePosition,
			ConsumedWaitingPromptID: strings.TrimSpace(resp.ConsumedWaitingPromptID),
			AppliedPermissionType:   strings.TrimSpace(resp.AppliedPermissionType),
		}, nil
	})

	accessgate.RegisterTyped[aiSubmitRequestUserInputResponseReq, aiSubmitRequestUserInputResponseResp](r, TypeID_AI_SUBMIT_REQUEST_USER_INPUT_RESPONSE, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *aiSubmitRequestUserInputResponseReq) (*aiSubmitRequestUserInputResponseResp, error) {
		if meta == nil || !meta.CanRead || !meta.CanWrite || !meta.CanExecute {
			return nil, &rpc.Error{Code: 403, Message: "read/write/execute permission denied"}
		}
		if !s.Enabled() {
			return nil, &rpc.Error{Code: 503, Message: "ai not configured"}
		}
		if req == nil {
			return nil, &rpc.Error{Code: 400, Message: "invalid payload"}
		}
		resp, err := s.SubmitRequestUserInputResponse(ctx, meta, SubmitRequestUserInputResponseRequest{
			ThreadID:         strings.TrimSpace(req.ThreadID),
			Model:            strings.TrimSpace(req.Model),
			Response:         req.Response,
			Input:            req.Input,
			Options:          req.Options,
			ExpectedRunID:    strings.TrimSpace(req.ExpectedRunID),
			SourceFollowupID: strings.TrimSpace(req.SourceFollowupID),
		})
		if err != nil {
			return nil, toAIRPCError(err)
		}
		return &aiSubmitRequestUserInputResponseResp{
			RunID:                   strings.TrimSpace(resp.RunID),
			Kind:                    strings.TrimSpace(resp.Kind),
			ConsumedWaitingPromptID: strings.TrimSpace(resp.ConsumedWaitingPromptID),
			AppliedPermissionType:   strings.TrimSpace(resp.AppliedPermissionType),
		}, nil
	})

	accessgate.RegisterTyped[aiCompactThreadContextReq, aiCompactThreadContextResp](r, TypeID_AI_COMPACT_THREAD_CONTEXT, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *aiCompactThreadContextReq) (*aiCompactThreadContextResp, error) {
		if meta == nil || !meta.CanRead || !meta.CanWrite || !meta.CanExecute {
			return nil, &rpc.Error{Code: 403, Message: "read/write/execute permission denied"}
		}
		if !s.Enabled() {
			return nil, &rpc.Error{Code: 503, Message: "ai not configured"}
		}
		if req == nil {
			return nil, &rpc.Error{Code: 400, Message: "invalid payload"}
		}
		threadID := strings.TrimSpace(req.ThreadID)
		if threadID == "" {
			return nil, &rpc.Error{Code: 400, Message: "missing thread_id"}
		}
		resp, err := s.CompactThreadContext(ctx, meta, CompactThreadContextRequest{
			ThreadID:      threadID,
			ExpectedRunID: strings.TrimSpace(req.ExpectedRunID),
			Source:        strings.TrimSpace(req.Source),
		})
		if err != nil {
			return nil, toAIRPCError(err)
		}
		return &aiCompactThreadContextResp{
			OperationID: strings.TrimSpace(resp.OperationID),
			Kind:        strings.TrimSpace(resp.Kind),
			ErrorCode:   strings.TrimSpace(resp.ErrorCode),
		}, nil
	})

	accessgate.RegisterTyped[aiSubscribeSummaryReq, aiSubscribeSummaryResp](r, TypeID_AI_SUBSCRIBE_SUMMARY, gate, meta, accessgate.RPCAccessProtected, func(_ context.Context, _ *aiSubscribeSummaryReq) (*aiSubscribeSummaryResp, error) {
		if meta == nil || !meta.CanRead || !meta.CanWrite || !meta.CanExecute {
			return nil, &rpc.Error{Code: 403, Message: "read/write/execute permission denied"}
		}
		if streamServer == nil {
			return nil, &rpc.Error{Code: 500, Message: "stream not ready"}
		}
		activeRuns, err := s.SubscribeSummary(strings.TrimSpace(meta.EndpointID), streamServer)
		if err != nil {
			return nil, toAIRPCError(err)
		}
		return &aiSubscribeSummaryResp{ActiveRuns: activeRuns}, nil
	})

	accessgate.RegisterTyped[aiSubscribeThreadReq, aiSubscribeThreadResp](r, TypeID_AI_SUBSCRIBE_THREAD, gate, meta, accessgate.RPCAccessProtected, func(_ context.Context, req *aiSubscribeThreadReq) (*aiSubscribeThreadResp, error) {
		if meta == nil || !meta.CanRead || !meta.CanWrite || !meta.CanExecute {
			return nil, &rpc.Error{Code: 403, Message: "read/write/execute permission denied"}
		}
		if streamServer == nil {
			return nil, &rpc.Error{Code: 500, Message: "stream not ready"}
		}
		if req == nil {
			return nil, &rpc.Error{Code: 400, Message: "invalid payload"}
		}
		threadID := strings.TrimSpace(req.ThreadID)
		if threadID == "" {
			return nil, &rpc.Error{Code: 400, Message: "missing thread_id"}
		}
		runID, err := s.SubscribeThread(strings.TrimSpace(meta.EndpointID), threadID, streamServer)
		if err != nil {
			return nil, toAIRPCError(err)
		}
		return &aiSubscribeThreadResp{RunID: strings.TrimSpace(runID)}, nil
	})

	accessgate.RegisterTyped[aiStopThreadReq, aiStopThreadResp](r, TypeID_AI_STOP_THREAD, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *aiStopThreadReq) (*aiStopThreadResp, error) {
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
		out, err := s.StopThread(ctx, meta, threadID)
		if err != nil {
			return nil, toAIRPCError(err)
		}
		return &aiStopThreadResp{OK: out.OK, RecoveredFollowups: out.RecoveredFollowups}, nil
	})

	accessgate.RegisterTyped[aiListMessagesReq, aiListMessagesResp](r, TypeID_AI_MESSAGES_LIST, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *aiListMessagesReq) (*aiListMessagesResp, error) {
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
			raw, err := SanitizeActivityTimelineMessageJSON(m.MessageJSON)
			if err != nil {
				return nil, toAIRPCError(err)
			}
			if len(raw) == 0 {
				continue
			}
			out.Messages = append(out.Messages, aiTranscriptMessageItem{
				RowID:       m.ID,
				MessageJSON: raw,
			})
		}
		return out, nil
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
	case errors.Is(err, ErrThreadBusy),
		errors.Is(err, ErrRunChanged),
		errors.Is(err, ErrWaitingPromptChanged),
		errors.Is(err, ErrModelLockViolation),
		errors.Is(err, ErrModelSwitchRequiresExplicitRestart),
		errors.Is(err, ErrFollowupsRevisionChanged),
		errors.Is(err, ErrCompactAlreadyPending),
		errors.Is(err, ErrNoCompactableContext):
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
