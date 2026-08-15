package ai

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	flruntime "github.com/floegence/floret/v4/runtime"
	flowersec "github.com/floegence/flowersec/flowersec-go/v2"
	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionrpc"
)

const (
	// Type IDs must stay in sync with
	// internal/envapp/ui_src/src/ui/protocol/redeven_v1/typeIds.ts.
	TypeID_AI_SEND_USER_TURN                     uint32 = 6001
	TypeID_AI_EVENT_NOTIFY                       uint32 = 6004 // notify (agent -> client)
	TypeID_AI_MESSAGES_LIST                      uint32 = 6006
	TypeID_AI_STOP_THREAD                        uint32 = 6011
	TypeID_AI_SUBMIT_REQUEST_USER_INPUT_RESPONSE uint32 = 6012
)

type aiSendUserTurnReq struct {
	ClientRequestID string     `json:"client_request_id,omitempty"`
	ThreadID        string     `json:"thread_id"`
	Model           string     `json:"model,omitempty"`
	Input           RunInput   `json:"input"`
	Options         RunOptions `json:"options"`
}

type aiSendUserTurnResp struct {
	ClientRequestID       string               `json:"client_request_id,omitempty"`
	RunID                 string               `json:"run_id"`
	TurnID                string               `json:"turn_id"`
	Kind                  string               `json:"kind"`
	QueueID               string               `json:"queue_id,omitempty"`
	QueuePosition         int                  `json:"queue_position,omitempty"`
	AppliedPermissionType string               `json:"applied_permission_type,omitempty"`
	Current               flruntime.ThreadView `json:"current"`
}

type aiSubmitRequestUserInputResponseReq struct {
	ThreadID string                   `json:"thread_id"`
	Model    string                   `json:"model,omitempty"`
	Response RequestUserInputResponse `json:"response"`
	Input    RunInput                 `json:"input"`
	Options  RunOptions               `json:"options"`
}

type aiSubmitRequestUserInputResponseResp struct {
	Kind                    string               `json:"kind"`
	ConsumedWaitingPromptID string               `json:"consumed_waiting_prompt_id,omitempty"`
	AppliedPermissionType   string               `json:"applied_permission_type,omitempty"`
	Current                 flruntime.ThreadView `json:"current"`
}

type aiStopThreadReq struct {
	ThreadID string `json:"thread_id"`
}

type aiStopThreadResp struct {
	OK bool `json:"ok"`
}

type aiListMessagesReq struct {
	ThreadID    string `json:"thread_id"`
	AfterRowID  int64  `json:"after_row_id,omitempty"`
	Tail        bool   `json:"tail,omitempty"`
	Limit       int    `json:"limit,omitempty"`
	IncludeBody bool   `json:"include_body,omitempty"`
}

type aiListMessagesResp struct {
	Messages            []aiTimelineMessageItem    `json:"messages"`
	TimelineDecorations []FlowerTimelineDecoration `json:"timeline_decorations,omitempty"`
	NextAfterRowID      int64                      `json:"next_after_row_id,omitempty"`
	HasMore             bool                       `json:"has_more,omitempty"`
}

type aiTimelineMessageItem struct {
	RowID       int64           `json:"row_id"`
	MessageJSON json.RawMessage `json:"message_json"`
}

func (s *Service) RegisterRPC(r *sessionrpc.Router, meta *session.Meta, streamServer flowersec.RPCPeer) {
	s.RegisterRPCWithAccessGate(r, meta, streamServer, nil)
}

func (s *Service) RegisterRPCWithAccessGate(r *sessionrpc.Router, meta *session.Meta, streamServer flowersec.RPCPeer, gate *accessgate.Gate) {
	if s == nil {
		return
	}
	RegisterRPCServiceProviderWithAccessGate(r, meta, streamServer, gate, func(ctx context.Context) (*Service, context.Context, uint64, func(), error) {
		return s, ctx, 0, func() {}, nil
	})
}

type RPCServiceAcquire func(context.Context) (*Service, context.Context, uint64, func(), error)

func RegisterRPCServiceProviderWithAccessGate(r *sessionrpc.Router, meta *session.Meta, streamServer flowersec.RPCPeer, gate *accessgate.Gate, acquire RPCServiceAcquire) func() {
	if r == nil || acquire == nil {
		return func() {}
	}
	accessgate.RegisterTyped[aiSendUserTurnReq, aiSendUserTurnResp](r, TypeID_AI_SEND_USER_TURN, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *aiSendUserTurnReq) (*aiSendUserTurnResp, error) {
		if meta == nil || !meta.CanRead || !meta.CanWrite || !meta.CanExecute {
			return nil, &sessionrpc.Error{Code: 403, Message: "read/write/execute permission denied"}
		}
		if req == nil {
			return nil, &sessionrpc.Error{Code: 400, Message: "invalid payload"}
		}
		service, leaseCtx, release, acquireErr := acquireRPCService(ctx, acquire)
		if acquireErr != nil {
			return nil, acquireErr
		}
		defer release()
		if !service.Enabled() {
			return nil, &sessionrpc.Error{Code: 503, Message: "ai not configured"}
		}
		resp, err := service.SendUserTurn(leaseCtx, meta, SendUserTurnRequest{
			ClientRequestID: strings.TrimSpace(req.ClientRequestID),
			ThreadID:        strings.TrimSpace(req.ThreadID),
			Model:           strings.TrimSpace(req.Model),
			Input:           req.Input,
			Options:         req.Options,
		})
		if err != nil {
			return nil, toAIRPCError(err)
		}
		return &aiSendUserTurnResp{
			ClientRequestID:       strings.TrimSpace(resp.ClientRequestID),
			RunID:                 strings.TrimSpace(resp.RunID),
			TurnID:                strings.TrimSpace(resp.TurnID),
			Kind:                  strings.TrimSpace(resp.Kind),
			QueueID:               strings.TrimSpace(resp.QueueID),
			QueuePosition:         resp.QueuePosition,
			AppliedPermissionType: strings.TrimSpace(resp.AppliedPermissionType),
			Current:               resp.Current,
		}, nil
	})

	accessgate.RegisterTyped[aiSubmitRequestUserInputResponseReq, aiSubmitRequestUserInputResponseResp](r, TypeID_AI_SUBMIT_REQUEST_USER_INPUT_RESPONSE, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *aiSubmitRequestUserInputResponseReq) (*aiSubmitRequestUserInputResponseResp, error) {
		if meta == nil || !meta.CanRead || !meta.CanWrite || !meta.CanExecute {
			return nil, &sessionrpc.Error{Code: 403, Message: "read/write/execute permission denied"}
		}
		if req == nil {
			return nil, &sessionrpc.Error{Code: 400, Message: "invalid payload"}
		}
		service, leaseCtx, release, acquireErr := acquireRPCService(ctx, acquire)
		if acquireErr != nil {
			return nil, acquireErr
		}
		defer release()
		if !service.Enabled() {
			return nil, &sessionrpc.Error{Code: 503, Message: "ai not configured"}
		}
		resp, err := service.SubmitRequestUserInputResponse(leaseCtx, meta, SubmitRequestUserInputResponseRequest{
			ThreadID: strings.TrimSpace(req.ThreadID),
			Model:    strings.TrimSpace(req.Model),
			Response: req.Response,
			Input:    req.Input,
			Options:  req.Options,
		})
		if err != nil {
			return nil, toAIRPCError(err)
		}
		return &aiSubmitRequestUserInputResponseResp{
			Kind:                    strings.TrimSpace(resp.Kind),
			ConsumedWaitingPromptID: strings.TrimSpace(resp.ConsumedWaitingPromptID),
			AppliedPermissionType:   strings.TrimSpace(resp.AppliedPermissionType),
			Current:                 resp.Current,
		}, nil
	})

	accessgate.RegisterTyped[aiStopThreadReq, aiStopThreadResp](r, TypeID_AI_STOP_THREAD, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *aiStopThreadReq) (*aiStopThreadResp, error) {
		if meta == nil || !meta.CanRead || !meta.CanWrite || !meta.CanExecute {
			return nil, &sessionrpc.Error{Code: 403, Message: "read/write/execute permission denied"}
		}
		if req == nil {
			return nil, &sessionrpc.Error{Code: 400, Message: "invalid payload"}
		}
		threadID := strings.TrimSpace(req.ThreadID)
		if threadID == "" {
			return nil, &sessionrpc.Error{Code: 400, Message: "missing thread_id"}
		}
		service, leaseCtx, release, acquireErr := acquireRPCService(ctx, acquire)
		if acquireErr != nil {
			return nil, acquireErr
		}
		defer release()
		out, err := service.StopThread(leaseCtx, meta, threadID)
		if err != nil {
			return nil, toAIRPCError(err)
		}
		return &aiStopThreadResp{OK: out.OK}, nil
	})

	accessgate.RegisterTyped[aiListMessagesReq, aiListMessagesResp](r, TypeID_AI_MESSAGES_LIST, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *aiListMessagesReq) (*aiListMessagesResp, error) {
		if meta == nil || !meta.CanRead || !meta.CanWrite || !meta.CanExecute {
			return nil, &sessionrpc.Error{Code: 403, Message: "read/write/execute permission denied"}
		}
		if req == nil {
			return nil, &sessionrpc.Error{Code: 400, Message: "invalid payload"}
		}
		threadID := strings.TrimSpace(req.ThreadID)
		if threadID == "" {
			return nil, &sessionrpc.Error{Code: 400, Message: "missing thread_id"}
		}
		service, leaseCtx, release, acquireErr := acquireRPCService(ctx, acquire)
		if acquireErr != nil {
			return nil, acquireErr
		}
		defer release()
		ctx = leaseCtx

		service.mu.Lock()
		db := service.threadsDB
		service.mu.Unlock()
		if db == nil {
			return nil, &sessionrpc.Error{Code: 503, Message: "threads store not ready"}
		}

		// Ensure thread exists (consistent with other endpoints).
		if th, err := db.GetThreadSettings(ctx, strings.TrimSpace(meta.EndpointID), threadID); err != nil {
			return nil, &sessionrpc.Error{Code: 400, Message: err.Error()}
		} else if th == nil {
			return nil, &sessionrpc.Error{Code: 404, Message: "thread not found"}
		}

		limit := req.Limit
		if limit <= 0 {
			limit = 200
		}
		if limit > 500 {
			limit = 500
		}

		endpointID := strings.TrimSpace(meta.EndpointID)
		msgs, nextAfter, hasMore, err := service.listThreadTimelineMessagesAfter(ctx, endpointID, threadID, limit, req.AfterRowID, req.Tail)
		if err != nil {
			return nil, toAIRPCError(err)
		}

		out := &aiListMessagesResp{
			Messages:            make([]aiTimelineMessageItem, 0, len(msgs)),
			TimelineDecorations: make([]FlowerTimelineDecoration, 0),
			NextAfterRowID:      nextAfter,
			HasMore:             hasMore,
		}
		for _, m := range msgs {
			if m.Decoration != nil {
				out.TimelineDecorations = append(out.TimelineDecorations, *m.Decoration)
				continue
			}
			if len(m.MessageJSON) == 0 {
				continue
			}
			out.Messages = append(out.Messages, aiTimelineMessageItem{
				RowID:       m.RowID,
				MessageJSON: m.MessageJSON,
			})
		}
		return out, nil
	})
	return func() {}
}

func acquireRPCService(ctx context.Context, acquire RPCServiceAcquire) (*Service, context.Context, func(), *sessionrpc.Error) {
	service, leaseCtx, _, release, err := acquire(ctx)
	if err != nil || service == nil || leaseCtx == nil || release == nil {
		if release != nil {
			release()
		}
		return nil, nil, nil, &sessionrpc.Error{Code: 503, Message: "AI service is unavailable"}
	}
	return service, leaseCtx, release, nil
}

func toAIRPCError(err error) *sessionrpc.Error {
	if err == nil {
		return nil
	}
	msg := strings.TrimSpace(err.Error())
	if msg == "" {
		msg = "request failed"
	}

	switch {
	case errors.Is(err, ErrNotConfigured):
		return &sessionrpc.Error{Code: 503, Message: "ai not configured"}
	case errors.Is(err, ErrThreadBusy),
		errors.Is(err, ErrRunChanged),
		errors.Is(err, ErrWaitingPromptChanged),
		errors.Is(err, ErrTurnIdempotencyConflict),
		errors.Is(err, ErrInitialTurnStateConflict):
		return &sessionrpc.Error{Code: 409, Message: msg}
	}

	s := strings.ToLower(msg)
	switch {
	case strings.Contains(s, "thread not found"), strings.Contains(s, "run not found"):
		return &sessionrpc.Error{Code: 404, Message: msg}
	case strings.Contains(s, "permission denied"):
		return &sessionrpc.Error{Code: 403, Message: msg}
	default:
		return &sessionrpc.Error{Code: 400, Message: msg}
	}
}
