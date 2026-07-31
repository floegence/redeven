package ai

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/floegence/flowersec/flowersec-go/rpc"
	"github.com/floegence/redeven/internal/accessgate"
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
	TurnID                  string `json:"turn_id"`
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
	TurnID                  string `json:"turn_id"`
	Kind                    string `json:"kind"`
	ConsumedWaitingPromptID string `json:"consumed_waiting_prompt_id,omitempty"`
	AppliedPermissionType   string `json:"applied_permission_type,omitempty"`
}

type aiCompactThreadContextReq struct {
	ThreadID    string `json:"thread_id"`
	ActiveRunID string `json:"active_run_id,omitempty"`
}

type aiCompactThreadContextResp struct {
	RequestID string `json:"request_id,omitempty"`
	Kind      string `json:"kind"`
	ErrorCode string `json:"error_code,omitempty"`
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
	Messages            []aiTimelineMessageItem    `json:"messages"`
	TimelineDecorations []FlowerTimelineDecoration `json:"timeline_decorations,omitempty"`
	NextAfterRowID      int64                      `json:"next_after_row_id,omitempty"`
	HasMore             bool                       `json:"has_more,omitempty"`
}

type aiTimelineMessageItem struct {
	RowID       int64           `json:"row_id"`
	MessageJSON json.RawMessage `json:"message_json"`
}

func (s *Service) RegisterRPC(r *rpc.Router, meta *session.Meta, streamServer *rpc.Server) {
	s.RegisterRPCWithAccessGate(r, meta, streamServer, nil)
}

func (s *Service) RegisterRPCWithAccessGate(r *rpc.Router, meta *session.Meta, streamServer *rpc.Server, gate *accessgate.Gate) {
	if s == nil {
		return
	}
	RegisterRPCServiceProviderWithAccessGate(r, meta, streamServer, gate, func(ctx context.Context) (*Service, context.Context, uint64, func(), error) {
		return s, ctx, 0, func() {}, nil
	})
}

type RPCServiceAcquire func(context.Context) (*Service, context.Context, uint64, func(), error)

func RegisterRPCServiceProviderWithAccessGate(r *rpc.Router, meta *session.Meta, streamServer *rpc.Server, gate *accessgate.Gate, acquire RPCServiceAcquire) func() {
	if r == nil || acquire == nil {
		return func() {}
	}
	realtimeSubscriptions := newRPCRealtimeSubscriptions(meta, streamServer, acquire)

	accessgate.RegisterTyped[aiSendUserTurnReq, aiSendUserTurnResp](r, TypeID_AI_SEND_USER_TURN, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *aiSendUserTurnReq) (*aiSendUserTurnResp, error) {
		if meta == nil || !meta.CanRead || !meta.CanWrite || !meta.CanExecute {
			return nil, &rpc.Error{Code: 403, Message: "read/write/execute permission denied"}
		}
		if req == nil {
			return nil, &rpc.Error{Code: 400, Message: "invalid payload"}
		}
		if strings.TrimSpace(req.Input.TurnID) != "" {
			return nil, &rpc.Error{Code: 400, Message: "turn_id must be omitted before canonical admission"}
		}
		service, leaseCtx, release, acquireErr := acquireRPCService(ctx, acquire)
		if acquireErr != nil {
			return nil, acquireErr
		}
		defer release()
		if !service.Enabled() {
			return nil, &rpc.Error{Code: 503, Message: "ai not configured"}
		}
		resp, err := service.SendUserTurn(leaseCtx, meta, SendUserTurnRequest{
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
			TurnID:                  strings.TrimSpace(resp.TurnID),
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
		if req == nil {
			return nil, &rpc.Error{Code: 400, Message: "invalid payload"}
		}
		if strings.TrimSpace(req.Input.TurnID) != "" {
			return nil, &rpc.Error{Code: 400, Message: "turn_id must be omitted before canonical admission"}
		}
		service, leaseCtx, release, acquireErr := acquireRPCService(ctx, acquire)
		if acquireErr != nil {
			return nil, acquireErr
		}
		defer release()
		if !service.Enabled() {
			return nil, &rpc.Error{Code: 503, Message: "ai not configured"}
		}
		resp, err := service.SubmitRequestUserInputResponse(leaseCtx, meta, SubmitRequestUserInputResponseRequest{
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
			TurnID:                  strings.TrimSpace(resp.TurnID),
			Kind:                    strings.TrimSpace(resp.Kind),
			ConsumedWaitingPromptID: strings.TrimSpace(resp.ConsumedWaitingPromptID),
			AppliedPermissionType:   strings.TrimSpace(resp.AppliedPermissionType),
		}, nil
	})

	accessgate.RegisterTyped[aiCompactThreadContextReq, aiCompactThreadContextResp](r, TypeID_AI_COMPACT_THREAD_CONTEXT, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *aiCompactThreadContextReq) (*aiCompactThreadContextResp, error) {
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
		service, leaseCtx, release, acquireErr := acquireRPCService(ctx, acquire)
		if acquireErr != nil {
			return nil, acquireErr
		}
		defer release()
		if !service.Enabled() {
			return nil, &rpc.Error{Code: 503, Message: "ai not configured"}
		}
		resp, err := service.CompactThreadContext(leaseCtx, meta, CompactThreadContextRequest{
			ThreadID:    threadID,
			ActiveRunID: strings.TrimSpace(req.ActiveRunID),
		})
		if err != nil {
			return nil, toAIRPCError(err)
		}
		return &aiCompactThreadContextResp{
			RequestID: strings.TrimSpace(resp.RequestID),
			Kind:      strings.TrimSpace(resp.Kind),
			ErrorCode: strings.TrimSpace(resp.ErrorCode),
		}, nil
	})

	accessgate.RegisterTyped[aiSubscribeSummaryReq, aiSubscribeSummaryResp](r, TypeID_AI_SUBSCRIBE_SUMMARY, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, _ *aiSubscribeSummaryReq) (*aiSubscribeSummaryResp, error) {
		if meta == nil || !meta.CanRead || !meta.CanWrite || !meta.CanExecute {
			return nil, &rpc.Error{Code: 403, Message: "read/write/execute permission denied"}
		}
		if streamServer == nil {
			return nil, &rpc.Error{Code: 500, Message: "stream not ready"}
		}
		activeRuns, subscribeErr := realtimeSubscriptions.SubscribeSummary()
		if subscribeErr != nil {
			return nil, subscribeErr
		}
		return &aiSubscribeSummaryResp{ActiveRuns: activeRuns}, nil
	})

	accessgate.RegisterTyped[aiSubscribeThreadReq, aiSubscribeThreadResp](r, TypeID_AI_SUBSCRIBE_THREAD, gate, meta, accessgate.RPCAccessProtected, func(ctx context.Context, req *aiSubscribeThreadReq) (*aiSubscribeThreadResp, error) {
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
		runID, subscribeErr := realtimeSubscriptions.SubscribeThread(threadID)
		if subscribeErr != nil {
			return nil, subscribeErr
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
		service, leaseCtx, release, acquireErr := acquireRPCService(ctx, acquire)
		if acquireErr != nil {
			return nil, acquireErr
		}
		defer release()
		out, err := service.StopThread(leaseCtx, meta, threadID)
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
			return nil, &rpc.Error{Code: 503, Message: "threads store not ready"}
		}

		// Ensure thread exists (consistent with other endpoints).
		if th, err := db.GetThreadSettings(ctx, strings.TrimSpace(meta.EndpointID), threadID); err != nil {
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
	return realtimeSubscriptions.Close
}

type rpcRealtimeSubscriptions struct {
	mu sync.Mutex

	ctx          context.Context
	cancel       context.CancelFunc
	acquire      RPCServiceAcquire
	streamServer *rpc.Server
	endpointID   string

	closed   bool
	summary  bool
	threadID string

	current    *Service
	leaseCtx   context.Context
	release    func()
	bindingSeq uint64
	closeOnce  sync.Once
	watchers   sync.WaitGroup
}

func newRPCRealtimeSubscriptions(meta *session.Meta, streamServer *rpc.Server, acquire RPCServiceAcquire) *rpcRealtimeSubscriptions {
	ctx, cancel := context.WithCancel(context.Background())
	endpointID := ""
	if meta != nil {
		endpointID = strings.TrimSpace(meta.EndpointID)
	}
	return &rpcRealtimeSubscriptions{
		ctx: ctx, cancel: cancel, acquire: acquire, streamServer: streamServer, endpointID: endpointID,
	}
}

func (s *rpcRealtimeSubscriptions) SubscribeSummary() ([]ActiveThreadRun, *rpc.Error) {
	if s == nil {
		return nil, &rpc.Error{Code: 503, Message: "AI service is unavailable"}
	}
	service, leaseCtx, release, rpcErr := acquireRPCService(s.ctx, s.acquire)
	if rpcErr != nil {
		return nil, rpcErr
	}
	activeRuns, _, bindErr := s.bindAcquired(service, leaseCtx, release, true, "")
	return activeRuns, bindErr
}

func (s *rpcRealtimeSubscriptions) SubscribeThread(threadID string) (string, *rpc.Error) {
	if s == nil {
		return "", &rpc.Error{Code: 503, Message: "AI service is unavailable"}
	}
	service, leaseCtx, release, rpcErr := acquireRPCService(s.ctx, s.acquire)
	if rpcErr != nil {
		return "", rpcErr
	}
	_, runID, bindErr := s.bindAcquired(service, leaseCtx, release, false, strings.TrimSpace(threadID))
	return runID, bindErr
}

func (s *rpcRealtimeSubscriptions) bindAcquired(
	service *Service,
	leaseCtx context.Context,
	release func(),
	addSummary bool,
	addThreadID string,
) ([]ActiveThreadRun, string, *rpc.Error) {
	if release == nil {
		return nil, "", &rpc.Error{Code: 503, Message: "AI service is unavailable"}
	}

	s.mu.Lock()
	if s.closed || service == nil || leaseCtx == nil || s.streamServer == nil || s.endpointID == "" {
		s.mu.Unlock()
		release()
		return nil, "", &rpc.Error{Code: 503, Message: "AI service is unavailable"}
	}

	requestedThreadID := strings.TrimSpace(addThreadID)
	if service == s.current {
		var activeRuns []ActiveThreadRun
		var runID string
		if addSummary && !s.summary {
			var err error
			activeRuns, err = service.SubscribeSummary(s.endpointID, s.streamServer)
			if err != nil {
				s.mu.Unlock()
				release()
				return nil, "", toAIRPCError(err)
			}
			s.summary = true
		} else if addSummary {
			activeRuns = service.ListActiveThreadRuns(s.endpointID)
		}
		if requestedThreadID != "" && requestedThreadID != s.threadID {
			var err error
			runID, err = service.SubscribeThread(s.endpointID, requestedThreadID, s.streamServer)
			if err != nil {
				s.mu.Unlock()
				release()
				return nil, "", toAIRPCError(err)
			}
			s.threadID = requestedThreadID
		} else if requestedThreadID != "" {
			service.mu.Lock()
			runID = strings.TrimSpace(service.activeRunByTh[runThreadKey(s.endpointID, requestedThreadID)])
			service.mu.Unlock()
		}
		s.mu.Unlock()
		release()
		return activeRuns, runID, nil
	}

	wantSummary := s.summary || addSummary
	wantThreadID := s.threadID
	if requestedThreadID != "" {
		wantThreadID = requestedThreadID
	}
	var activeRuns []ActiveThreadRun
	var runID string
	if wantSummary {
		var err error
		activeRuns, err = service.SubscribeSummary(s.endpointID, s.streamServer)
		if err != nil {
			s.mu.Unlock()
			release()
			return nil, "", toAIRPCError(err)
		}
	}
	if wantThreadID != "" {
		var err error
		runID, err = service.SubscribeThread(s.endpointID, wantThreadID, s.streamServer)
		if err != nil {
			service.DetachRealtimeSink(s.streamServer)
			s.mu.Unlock()
			release()
			return nil, "", toAIRPCError(err)
		}
	}

	previous := s.current
	previousRelease := s.release
	s.current = service
	s.leaseCtx = leaseCtx
	s.release = release
	s.summary = wantSummary
	s.threadID = wantThreadID
	s.bindingSeq++
	seq := s.bindingSeq
	s.watchers.Add(1)
	s.mu.Unlock()

	if previous != nil {
		previous.DetachRealtimeSink(s.streamServer)
	}
	if previousRelease != nil {
		previousRelease()
	}
	go func() {
		defer s.watchers.Done()
		s.watchGeneration(service, seq, leaseCtx)
	}()
	return activeRuns, runID, nil
}

func (s *rpcRealtimeSubscriptions) watchGeneration(service *Service, seq uint64, leaseCtx context.Context) {
	select {
	case <-leaseCtx.Done():
		s.releaseGeneration(service, seq)
	case <-s.ctx.Done():
	}
}

func (s *rpcRealtimeSubscriptions) releaseGeneration(service *Service, seq uint64) {
	s.mu.Lock()
	if s.closed || s.current != service || s.bindingSeq != seq {
		s.mu.Unlock()
		return
	}
	release := s.release
	s.current = nil
	s.leaseCtx = nil
	s.release = nil
	s.bindingSeq++
	shouldRebind := s.summary || s.threadID != ""
	s.mu.Unlock()

	service.DetachRealtimeSink(s.streamServer)
	if release != nil {
		release()
	}
	if shouldRebind {
		s.rebind()
	}
}

func (s *rpcRealtimeSubscriptions) rebind() {
	for {
		s.mu.Lock()
		active := !s.closed && s.current == nil && (s.summary || s.threadID != "")
		s.mu.Unlock()
		if !active {
			return
		}

		service, leaseCtx, release, rpcErr := acquireRPCService(s.ctx, s.acquire)
		if rpcErr == nil {
			_, _, bindErr := s.bindAcquired(service, leaseCtx, release, false, "")
			if bindErr == nil {
				return
			}
		}

		timer := time.NewTimer(50 * time.Millisecond)
		select {
		case <-timer.C:
		case <-s.ctx.Done():
			timer.Stop()
			return
		}
	}
}

func (s *rpcRealtimeSubscriptions) Close() {
	if s == nil {
		return
	}
	s.closeOnce.Do(func() {
		s.cancel()
		s.mu.Lock()
		s.closed = true
		service := s.current
		release := s.release
		s.current = nil
		s.leaseCtx = nil
		s.release = nil
		s.bindingSeq++
		s.mu.Unlock()
		if service != nil {
			service.DetachRealtimeSink(s.streamServer)
		}
		if release != nil {
			release()
		}
		s.watchers.Wait()
	})
}

func acquireRPCService(ctx context.Context, acquire RPCServiceAcquire) (*Service, context.Context, func(), *rpc.Error) {
	service, leaseCtx, _, release, err := acquire(ctx)
	if err != nil || service == nil || leaseCtx == nil || release == nil {
		if release != nil {
			release()
		}
		return nil, nil, nil, &rpc.Error{Code: 503, Message: "AI service is unavailable"}
	}
	return service, leaseCtx, release, nil
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
	case errors.Is(err, ErrThreadStopUnavailable):
		return &rpc.Error{Code: 503, Message: msg}
	case errors.Is(err, ErrThreadBusy),
		errors.Is(err, ErrRunChanged),
		errors.Is(err, ErrWaitingPromptChanged),
		errors.Is(err, ErrTurnIdempotencyConflict),
		errors.Is(err, ErrInitialTurnStateConflict),
		errors.Is(err, ErrFollowupsRevisionChanged),
		errors.Is(err, ErrCompactAlreadyPending),
		errors.Is(err, ErrNoCompactableContext),
		errors.Is(err, ErrCanonicalTimelineResyncRequired),
		errors.Is(err, ErrThreadStopPending):
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
