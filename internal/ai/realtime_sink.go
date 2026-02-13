package ai

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/floegence/flowersec/flowersec-go/rpc"
	"github.com/floegence/redeven-agent/internal/ai/threadstore"
)

func (s *Service) ListActiveThreadRuns(endpointID string) []ActiveThreadRun {
	endpointID = strings.TrimSpace(endpointID)
	if s == nil || endpointID == "" {
		return nil
	}

	type activeRef struct {
		threadID string
		runID    string
	}

	prefix := endpointID + ":"
	refs := make([]activeRef, 0)

	s.mu.Lock()
	for key, runID := range s.activeRunByTh {
		rid := strings.TrimSpace(runID)
		if rid == "" {
			continue
		}
		if !strings.HasPrefix(key, prefix) {
			continue
		}
		tid := strings.TrimSpace(strings.TrimPrefix(key, prefix))
		if tid == "" {
			continue
		}
		refs = append(refs, activeRef{threadID: tid, runID: rid})
	}
	s.mu.Unlock()

	sort.Slice(refs, func(i, j int) bool {
		if refs[i].threadID == refs[j].threadID {
			return refs[i].runID < refs[j].runID
		}
		return refs[i].threadID < refs[j].threadID
	})

	out := make([]ActiveThreadRun, 0, len(refs))
	for _, it := range refs {
		out = append(out, ActiveThreadRun{ThreadID: it.threadID, RunID: it.runID})
	}
	return out
}

func (s *Service) SubscribeEndpoint(endpointID string, streamServer *rpc.Server) ([]ActiveThreadRun, error) {
	endpointID = strings.TrimSpace(endpointID)
	if s == nil {
		return nil, errors.New("nil service")
	}
	if endpointID == "" || streamServer == nil {
		return nil, errors.New("invalid subscribe request")
	}

	s.mu.Lock()
	if prev := strings.TrimSpace(s.realtimeEndpointBySRV[streamServer]); prev != "" && prev != endpointID {
		if bySrv := s.realtimeByEndpoint[prev]; bySrv != nil {
			delete(bySrv, streamServer)
			if len(bySrv) == 0 {
				delete(s.realtimeByEndpoint, prev)
			}
		}
	}
	if s.realtimeWriters[streamServer] == nil {
		s.realtimeWriters[streamServer] = newAISinkWriter(streamServer)
	}
	bySrv := s.realtimeByEndpoint[endpointID]
	if bySrv == nil {
		bySrv = make(map[*rpc.Server]struct{})
		s.realtimeByEndpoint[endpointID] = bySrv
	}
	bySrv[streamServer] = struct{}{}
	s.realtimeEndpointBySRV[streamServer] = endpointID
	s.mu.Unlock()

	return s.ListActiveThreadRuns(endpointID), nil
}

func (s *Service) DetachRealtimeSink(streamServer *rpc.Server) {
	if s == nil || streamServer == nil {
		return
	}

	var writer *aiSinkWriter
	s.mu.Lock()
	if endpointID := strings.TrimSpace(s.realtimeEndpointBySRV[streamServer]); endpointID != "" {
		if bySrv := s.realtimeByEndpoint[endpointID]; bySrv != nil {
			delete(bySrv, streamServer)
			if len(bySrv) == 0 {
				delete(s.realtimeByEndpoint, endpointID)
			}
		}
	}
	delete(s.realtimeEndpointBySRV, streamServer)
	writer = s.realtimeWriters[streamServer]
	delete(s.realtimeWriters, streamServer)
	s.mu.Unlock()

	if writer != nil {
		writer.Close()
	}
}

func shouldPersistRealtimeEvent(ev RealtimeEvent) bool {
	if ev.EventType == RealtimeEventTypeThreadState {
		return true
	}
	// Skip noisy assistant delta frames; keep lifecycle/tool/terminal events.
	switch ev.StreamEvent.(type) {
	case streamEventBlockDelta:
		return false
	default:
		return true
	}
}

func (s *Service) persistRealtimeEvent(ev RealtimeEvent) {
	if s == nil || s.threadsDB == nil {
		return
	}
	if !shouldPersistRealtimeEvent(ev) {
		return
	}
	payload := map[string]any{
		"event_type":   ev.EventType,
		"stream_kind":  ev.StreamKind,
		"phase":        ev.Phase,
		"diag":         ev.Diag,
		"run_status":   ev.RunStatus,
		"run_error":    ev.RunError,
		"stream_event": ev.StreamEvent,
	}
	b, err := json.Marshal(payload)
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), s.persistOpTO)
	defer cancel()
	_ = s.threadsDB.AppendRunEvent(ctx, threadstore.RunEventRecord{
		EndpointID:  ev.EndpointID,
		ThreadID:    ev.ThreadID,
		RunID:       ev.RunID,
		StreamKind:  string(ev.StreamKind),
		EventType:   string(ev.EventType),
		PayloadJSON: truncateRunes(string(b), 6000),
		AtUnixMs:    ev.AtUnixMs,
	})
}

func (s *Service) broadcastRealtimeEvent(ev RealtimeEvent) {
	if s == nil {
		return
	}
	ev.EndpointID = strings.TrimSpace(ev.EndpointID)
	ev.ThreadID = strings.TrimSpace(ev.ThreadID)
	ev.RunID = strings.TrimSpace(ev.RunID)
	if ev.EndpointID == "" || ev.ThreadID == "" || ev.RunID == "" {
		return
	}
	if ev.AtUnixMs <= 0 {
		ev.AtUnixMs = time.Now().UnixMilli()
	}
	s.persistRealtimeEvent(ev)

	payload, err := json.Marshal(ev)
	if err != nil || len(payload) == 0 {
		return
	}

	writers := make([]*aiSinkWriter, 0)
	s.mu.Lock()
	if bySrv := s.realtimeByEndpoint[ev.EndpointID]; bySrv != nil {
		writers = make([]*aiSinkWriter, 0, len(bySrv))
		for srv := range bySrv {
			if w := s.realtimeWriters[srv]; w != nil {
				writers = append(writers, w)
			}
		}
	}
	s.mu.Unlock()

	if len(writers) == 0 {
		return
	}

	msg := aiSinkMsg{TypeID: TypeID_AI_EVENT_NOTIFY, Payload: payload}
	for _, w := range writers {
		w.TrySend(msg)
	}
}

func lifecyclePhaseForStatus(status string, runErr string) RealtimeLifecyclePhase {
	s := NormalizeRunState(status)
	runErr = strings.TrimSpace(runErr)
	switch s {
	case RunStateAccepted, RunStateRunning, RunStateWaitingApproval, RunStateRecovering:
		if s == RunStateAccepted || s == RunStateRunning {
			return RealtimePhaseStart
		}
		return RealtimePhaseStateChange
	case RunStateSuccess, RunStateCanceled, RunStateWaitingUser:
		return RealtimePhaseEnd
	case RunStateFailed, RunStateTimedOut:
		if runErr != "" {
			return RealtimePhaseError
		}
		return RealtimePhaseEnd
	default:
		return RealtimePhaseStateChange
	}
}

func classifyStreamKind(streamEvent any) RealtimeStreamKind {
	switch ev := streamEvent.(type) {
	case streamEventError:
		return RealtimeStreamKindLifecycle
	case streamEventLifecyclePhase:
		return RealtimeStreamKindLifecycle
	case streamEventBlockStart:
		if strings.TrimSpace(strings.ToLower(ev.BlockType)) == "tool-call" {
			return RealtimeStreamKindTool
		}
		return RealtimeStreamKindAssistant
	case streamEventBlockSet:
		blockMap, ok := ev.Block.(map[string]any)
		if ok {
			if t, _ := blockMap["type"].(string); strings.TrimSpace(strings.ToLower(t)) == "tool-call" {
				return RealtimeStreamKindTool
			}
		}
		if _, ok := ev.Block.(ToolCallBlock); ok {
			return RealtimeStreamKindTool
		}
		if _, ok := ev.Block.(*ToolCallBlock); ok {
			return RealtimeStreamKindTool
		}
		return RealtimeStreamKindAssistant
	default:
		return RealtimeStreamKindAssistant
	}
}

func (s *Service) broadcastThreadState(endpointID string, threadID string, runID string, runStatus string, runErr string) {
	runStatus = strings.TrimSpace(runStatus)
	runErr = strings.TrimSpace(runErr)
	ev := RealtimeEvent{
		EventType:  RealtimeEventTypeThreadState,
		EndpointID: strings.TrimSpace(endpointID),
		ThreadID:   strings.TrimSpace(threadID),
		RunID:      strings.TrimSpace(runID),
		AtUnixMs:   time.Now().UnixMilli(),
		StreamKind: RealtimeStreamKindLifecycle,
		Phase:      lifecyclePhaseForStatus(runStatus, runErr),
		Diag: map[string]any{
			"run_status": runStatus,
		},
		RunStatus: runStatus,
		RunError:  runErr,
	}
	s.broadcastRealtimeEvent(ev)
}

func (s *Service) broadcastStreamEvent(endpointID string, threadID string, runID string, streamEvent any) {
	ev := RealtimeEvent{
		EventType:   RealtimeEventTypeStream,
		EndpointID:  strings.TrimSpace(endpointID),
		ThreadID:    strings.TrimSpace(threadID),
		RunID:       strings.TrimSpace(runID),
		AtUnixMs:    time.Now().UnixMilli(),
		StreamKind:  classifyStreamKind(streamEvent),
		StreamEvent: streamEvent,
	}
	s.broadcastRealtimeEvent(ev)
}

type aiSinkMsg struct {
	TypeID  uint32
	Payload json.RawMessage
}

type aiSinkWriter struct {
	srv *rpc.Server

	ch   chan aiSinkMsg
	once sync.Once
	done chan struct{}
}

func newAISinkWriter(srv *rpc.Server) *aiSinkWriter {
	w := &aiSinkWriter{
		srv:  srv,
		ch:   make(chan aiSinkMsg, 256),
		done: make(chan struct{}),
	}
	go w.loop()
	return w
}

func (w *aiSinkWriter) loop() {
	defer close(w.done)
	for msg := range w.ch {
		if w.srv == nil {
			return
		}
		if err := w.srv.Notify(msg.TypeID, msg.Payload); err != nil {
			return
		}
	}
}

func (w *aiSinkWriter) TrySend(msg aiSinkMsg) {
	if w == nil {
		return
	}
	select {
	case <-w.done:
		return
	default:
	}

	select {
	case w.ch <- msg:
	default:
	}
}

func (w *aiSinkWriter) Close() {
	if w == nil {
		return
	}
	w.once.Do(func() {
		close(w.ch)
	})
	<-w.done
}
