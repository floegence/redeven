package ai

import (
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/floegence/flowersec/flowersec-go/rpc"
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

func (s *Service) broadcastThreadState(endpointID string, threadID string, runID string, runStatus string, runErr string) {
	ev := RealtimeEvent{
		EventType:  RealtimeEventTypeThreadState,
		EndpointID: strings.TrimSpace(endpointID),
		ThreadID:   strings.TrimSpace(threadID),
		RunID:      strings.TrimSpace(runID),
		AtUnixMs:   time.Now().UnixMilli(),
		RunStatus:  strings.TrimSpace(runStatus),
		RunError:   strings.TrimSpace(runErr),
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
