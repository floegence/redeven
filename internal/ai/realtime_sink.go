package ai

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strconv"
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

func (s *Service) SubscribeSummary(endpointID string, streamServer *rpc.Server) ([]ActiveThreadRun, error) {
	endpointID = strings.TrimSpace(endpointID)
	if s == nil {
		return nil, errors.New("nil service")
	}
	if endpointID == "" || streamServer == nil {
		return nil, errors.New("invalid subscribe request")
	}

	s.mu.Lock()
	if prev := strings.TrimSpace(s.realtimeSummaryEndpointBySRV[streamServer]); prev != "" && prev != endpointID {
		if bySrv := s.realtimeSummaryByEndpoint[prev]; bySrv != nil {
			delete(bySrv, streamServer)
			if len(bySrv) == 0 {
				delete(s.realtimeSummaryByEndpoint, prev)
			}
		}
	}
	if s.realtimeWriters[streamServer] == nil {
		s.realtimeWriters[streamServer] = newAISinkWriter(streamServer)
	}
	bySrv := s.realtimeSummaryByEndpoint[endpointID]
	if bySrv == nil {
		bySrv = make(map[*rpc.Server]struct{})
		s.realtimeSummaryByEndpoint[endpointID] = bySrv
	}
	bySrv[streamServer] = struct{}{}
	s.realtimeSummaryEndpointBySRV[streamServer] = endpointID
	s.mu.Unlock()

	return s.ListActiveThreadRuns(endpointID), nil
}

func (s *Service) SubscribeThread(endpointID string, threadID string, streamServer *rpc.Server) (string, error) {
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if s == nil {
		return "", errors.New("nil service")
	}
	if endpointID == "" || threadID == "" || streamServer == nil {
		return "", errors.New("invalid subscribe request")
	}
	threadKey := runThreadKey(endpointID, threadID)
	if threadKey == "" {
		return "", errors.New("invalid subscribe request")
	}

	s.mu.Lock()
	if prev := strings.TrimSpace(s.realtimeThreadBySRV[streamServer]); prev != "" && prev != threadKey {
		if bySrv := s.realtimeByThread[prev]; bySrv != nil {
			delete(bySrv, streamServer)
			if len(bySrv) == 0 {
				delete(s.realtimeByThread, prev)
			}
		}
	}
	if s.realtimeWriters[streamServer] == nil {
		s.realtimeWriters[streamServer] = newAISinkWriter(streamServer)
	}
	bySrv := s.realtimeByThread[threadKey]
	if bySrv == nil {
		bySrv = make(map[*rpc.Server]struct{})
		s.realtimeByThread[threadKey] = bySrv
	}
	bySrv[streamServer] = struct{}{}
	s.realtimeThreadBySRV[streamServer] = threadKey

	runID := strings.TrimSpace(s.activeRunByTh[threadKey])
	s.mu.Unlock()
	return runID, nil
}

func (s *Service) DetachRealtimeSink(streamServer *rpc.Server) {
	if s == nil || streamServer == nil {
		return
	}

	var writer *aiSinkWriter
	s.mu.Lock()
	if endpointID := strings.TrimSpace(s.realtimeSummaryEndpointBySRV[streamServer]); endpointID != "" {
		if bySrv := s.realtimeSummaryByEndpoint[endpointID]; bySrv != nil {
			delete(bySrv, streamServer)
			if len(bySrv) == 0 {
				delete(s.realtimeSummaryByEndpoint, endpointID)
			}
		}
	}
	delete(s.realtimeSummaryEndpointBySRV, streamServer)
	if threadKey := strings.TrimSpace(s.realtimeThreadBySRV[streamServer]); threadKey != "" {
		if bySrv := s.realtimeByThread[threadKey]; bySrv != nil {
			delete(bySrv, streamServer)
			if len(bySrv) == 0 {
				delete(s.realtimeByThread, threadKey)
			}
		}
	}
	delete(s.realtimeThreadBySRV, streamServer)
	writer = s.realtimeWriters[streamServer]
	delete(s.realtimeWriters, streamServer)
	s.mu.Unlock()

	if writer != nil {
		writer.Close()
	}
}

func shouldPersistRealtimeEvent(ev RealtimeEvent) bool {
	if ev.EventType == RealtimeEventTypeTranscript {
		// Transcript messages are already persisted in transcript_messages and can be backfilled directly.
		return false
	}
	if ev.EventType == RealtimeEventTypeTranscriptReset {
		return false
	}
	if ev.EventType == RealtimeEventTypeThreadSummary {
		return false
	}
	if ev.EventType == RealtimeEventTypeThreadState {
		return true
	}
	// Skip noisy assistant delta frames; keep lifecycle/tool/terminal events.
	switch ev.StreamEvent.(type) {
	case streamEventBlockDelta:
		return false
	case streamEventContextUsage:
		// Context telemetry is persisted via explicit run events.
		return false
	case streamEventContextCompaction:
		// Context telemetry is persisted via explicit run events.
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
		"event_type":     ev.EventType,
		"stream_kind":    ev.StreamKind,
		"phase":          ev.Phase,
		"diag":           ev.Diag,
		"run_status":     ev.RunStatus,
		"run_error":      ev.RunError,
		"waiting_prompt": ev.WaitingPrompt,
		"stream_event":   ev.StreamEvent,
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
	if ev.EndpointID == "" || ev.ThreadID == "" {
		return
	}
	// run_id is required for run-scoped events, but transcript messages may be appended outside a run.
	if ev.EventType != RealtimeEventTypeTranscript && ev.EventType != RealtimeEventTypeTranscriptReset && ev.EventType != RealtimeEventTypeThreadSummary && ev.RunID == "" {
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
	switch ev.EventType {
	case RealtimeEventTypeThreadSummary:
		if bySrv := s.realtimeSummaryByEndpoint[ev.EndpointID]; bySrv != nil {
			writers = make([]*aiSinkWriter, 0, len(bySrv))
			for srv := range bySrv {
				if w := s.realtimeWriters[srv]; w != nil {
					writers = append(writers, w)
				}
			}
		}
	default:
		threadKey := runThreadKey(ev.EndpointID, ev.ThreadID)
		if bySrv := s.realtimeByThread[threadKey]; bySrv != nil {
			writers = make([]*aiSinkWriter, 0, len(bySrv))
			for srv := range bySrv {
				if w := s.realtimeWriters[srv]; w != nil {
					writers = append(writers, w)
				}
			}
		}
	}
	s.mu.Unlock()

	if len(writers) == 0 {
		return
	}

	msg := newAISinkMsg(TypeID_AI_EVENT_NOTIFY, ev, payload)
	priority := classifyRealtimePriority(ev)
	for _, w := range writers {
		w.TrySend(priority, msg)
	}
}

type aiSinkPriority uint8

const (
	aiSinkPriorityHigh aiSinkPriority = iota
	aiSinkPriorityLow
)

func classifyRealtimePriority(ev RealtimeEvent) aiSinkPriority {
	if ev.EventType == RealtimeEventTypeThreadState {
		return aiSinkPriorityHigh
	}
	if ev.EventType == RealtimeEventTypeTranscriptReset {
		return aiSinkPriorityHigh
	}
	switch ev.StreamEvent.(type) {
	case streamEventBlockDelta:
		return aiSinkPriorityLow
	case streamEventContextUsage:
		return aiSinkPriorityLow
	default:
		return aiSinkPriorityHigh
	}
}

func lifecyclePhaseForStatus(status string, runErr string) RealtimeLifecyclePhase {
	s := NormalizeRunState(status)
	runErr = strings.TrimSpace(runErr)
	switch s {
	case RunStateAccepted, RunStateRunning, RunStateWaitingApproval, RunStateRecovering, RunStateFinalizing:
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
	case streamEventContextUsage:
		return RealtimeStreamKindContext
	case streamEventContextCompaction:
		return RealtimeStreamKindContext
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
	var waitingPrompt *RequestUserInputPrompt
	if s != nil {
		s.mu.Lock()
		db := s.threadsDB
		persistTO := s.persistOpTO
		s.mu.Unlock()
		if db != nil {
			if persistTO <= 0 {
				persistTO = defaultPersistOpTimeout
			}
			ctx, cancel := context.WithTimeout(context.Background(), persistTO)
			th, err := db.GetThread(ctx, strings.TrimSpace(endpointID), strings.TrimSpace(threadID))
			if err == nil && th != nil {
				waitingPrompt = s.threadWaitingPrompt(ctx, th, runStatus)
			}
			cancel()
		}
	}
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
		RunStatus:     runStatus,
		RunError:      runErr,
		WaitingPrompt: waitingPrompt,
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

func (s *Service) broadcastTranscriptMessage(endpointID string, threadID string, runID string, rowID int64, messageJSON string, atUnixMs int64) {
	if s == nil {
		return
	}
	if rowID <= 0 {
		return
	}
	raw := strings.TrimSpace(messageJSON)
	if raw == "" {
		return
	}
	if atUnixMs <= 0 {
		atUnixMs = time.Now().UnixMilli()
	}
	ev := RealtimeEvent{
		EventType:    RealtimeEventTypeTranscript,
		EndpointID:   strings.TrimSpace(endpointID),
		ThreadID:     strings.TrimSpace(threadID),
		RunID:        strings.TrimSpace(runID),
		AtUnixMs:     atUnixMs,
		MessageRowID: rowID,
		MessageJSON:  json.RawMessage(raw),
	}
	s.broadcastRealtimeEvent(ev)
}

func (s *Service) broadcastTranscriptReset(endpointID string, threadID string, checkpointID string, reason string) {
	if s == nil {
		return
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	checkpointID = strings.TrimSpace(checkpointID)
	reason = strings.TrimSpace(reason)
	if endpointID == "" || threadID == "" {
		return
	}
	ev := RealtimeEvent{
		EventType:         RealtimeEventTypeTranscriptReset,
		EndpointID:        endpointID,
		ThreadID:          threadID,
		RunID:             "",
		AtUnixMs:          time.Now().UnixMilli(),
		ResetReason:       reason,
		ResetCheckpointID: checkpointID,
	}
	s.broadcastRealtimeEvent(ev)
}

func (s *Service) broadcastThreadSummary(endpointID string, threadID string) {
	if s == nil {
		return
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return
	}

	s.mu.Lock()
	db := s.threadsDB
	persistTO := s.persistOpTO
	activeRunID := strings.TrimSpace(s.activeRunByTh[runThreadKey(endpointID, threadID)])
	cfg := s.cfg
	s.mu.Unlock()
	if db == nil {
		return
	}
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}

	ctx, cancel := context.WithTimeout(context.Background(), persistTO)
	th, err := db.GetThread(ctx, endpointID, threadID)
	if err != nil || th == nil {
		cancel()
		return
	}
	queuedTurnCount, countErr := db.CountFollowupsByLane(ctx, endpointID, threadID, threadstore.FollowupLaneQueued)
	if countErr != nil {
		cancel()
		return
	}

	runStatus, runError := normalizeThreadRunState(th.RunStatus, th.RunError)
	if activeRunID != "" {
		runStatus, runError = activeThreadEffectiveRunState(th.RunStatus, th.RunError)
	}
	modeFallback := "act"
	if cfg != nil {
		modeFallback = cfg.EffectiveMode()
	}
	executionMode := normalizeRunMode(strings.TrimSpace(th.ExecutionMode), modeFallback)
	waitingPrompt := s.threadWaitingPrompt(ctx, th, runStatus)
	cancel()

	ev := RealtimeEvent{
		EventType:           RealtimeEventTypeThreadSummary,
		EndpointID:          endpointID,
		ThreadID:            threadID,
		RunID:               "",
		AtUnixMs:            time.Now().UnixMilli(),
		RunStatus:           runStatus,
		RunError:            runError,
		Title:               strings.TrimSpace(th.Title),
		UpdatedAtUnixMs:     th.UpdatedAtUnixMs,
		LastMessagePreview:  strings.TrimSpace(th.LastMessagePreview),
		LastMessageAtUnixMs: th.LastMessageAtUnixMs,
		ActiveRunID:         activeRunID,
		ExecutionMode:       executionMode,
		QueuedTurnCount:     queuedTurnCount,
		WaitingPrompt:       waitingPrompt,
	}
	s.broadcastRealtimeEvent(ev)
}

type aiSinkMsg struct {
	TypeID  uint32
	Payload json.RawMessage

	lowKey   string
	lowMode  aiSinkCoalesceMode
	lowBlock *aiSinkBlockDeltaEnvelope
}

type aiSinkCoalesceMode uint8

const (
	aiSinkCoalesceNone aiSinkCoalesceMode = iota
	aiSinkCoalesceAppendBlockDelta
	aiSinkCoalesceReplaceLatest
)

type aiSinkBlockDeltaEnvelope struct {
	Event RealtimeEvent
	Delta streamEventBlockDelta
}

type aiSinkNotifier interface {
	Notify(typeID uint32, payload json.RawMessage) error
}

func newAISinkMsg(typeID uint32, ev RealtimeEvent, payload json.RawMessage) aiSinkMsg {
	msg := aiSinkMsg{TypeID: typeID, Payload: payload}
	switch stream := ev.StreamEvent.(type) {
	case streamEventBlockDelta:
		msg.lowKey = strings.Join([]string{
			"block-delta",
			ev.EndpointID,
			ev.ThreadID,
			ev.RunID,
			stream.MessageID,
			strconv.Itoa(stream.BlockIndex),
		}, "\x00")
		msg.lowMode = aiSinkCoalesceAppendBlockDelta
		msg.lowBlock = &aiSinkBlockDeltaEnvelope{
			Event: ev,
			Delta: stream,
		}
	case streamEventContextUsage:
		msg.lowKey = strings.Join([]string{
			"context-usage",
			ev.EndpointID,
			ev.ThreadID,
			ev.RunID,
		}, "\x00")
		msg.lowMode = aiSinkCoalesceReplaceLatest
	}
	return msg
}

func mergeAISinkLowMsg(existing aiSinkMsg, incoming aiSinkMsg) aiSinkMsg {
	if existing.lowKey == "" || existing.lowKey != incoming.lowKey {
		return incoming
	}
	switch existing.lowMode {
	case aiSinkCoalesceAppendBlockDelta:
		return mergeAISinkBlockDeltaMsg(existing, incoming)
	case aiSinkCoalesceReplaceLatest:
		return incoming
	default:
		return incoming
	}
}

func mergeAISinkBlockDeltaMsg(existing aiSinkMsg, incoming aiSinkMsg) aiSinkMsg {
	if existing.lowBlock == nil || incoming.lowBlock == nil {
		return incoming
	}
	merged := existing
	block := *existing.lowBlock
	block.Delta.Delta += incoming.lowBlock.Delta.Delta
	block.Event.AtUnixMs = incoming.lowBlock.Event.AtUnixMs
	block.Event.StreamEvent = block.Delta
	payload, err := json.Marshal(block.Event)
	if err != nil {
		return incoming
	}
	merged.Payload = payload
	merged.lowBlock = &block
	return merged
}

type aiSinkWriter struct {
	notifier aiSinkNotifier

	hiCh   chan aiSinkMsg
	loWake chan struct{}
	stop   chan struct{}
	once   sync.Once
	done   chan struct{}

	mu         sync.Mutex
	lowSeq     uint64
	lowPending map[string]aiSinkMsg
	lowOrder   []string
}

func newAISinkWriter(srv *rpc.Server) *aiSinkWriter {
	return newAISinkWriterWithNotifier(srv)
}

func newAISinkWriterWithNotifier(notifier aiSinkNotifier) *aiSinkWriter {
	w := &aiSinkWriter{
		notifier:   notifier,
		hiCh:       make(chan aiSinkMsg, 1024),
		loWake:     make(chan struct{}, 1),
		stop:       make(chan struct{}),
		done:       make(chan struct{}),
		lowPending: make(map[string]aiSinkMsg),
	}
	go w.loop()
	return w
}

func (w *aiSinkWriter) loop() {
	defer close(w.done)
	for {
		// Drain high-priority queue first so terminal state events are never starved by delta floods.
		select {
		case <-w.stop:
			return
		case msg := <-w.hiCh:
			if err := w.notify(msg); err != nil {
				return
			}
			continue
		default:
		}

		if msg, ok := w.popLow(); ok {
			if err := w.notify(msg); err != nil {
				return
			}
			continue
		}

		select {
		case <-w.stop:
			return
		case msg := <-w.hiCh:
			if err := w.notify(msg); err != nil {
				return
			}
		case <-w.loWake:
		}
	}
}

func (w *aiSinkWriter) TrySend(priority aiSinkPriority, msg aiSinkMsg) {
	if w == nil {
		return
	}
	select {
	case <-w.stop:
		return
	default:
	}

	if priority == aiSinkPriorityHigh {
		select {
		case w.hiCh <- msg:
		default:
		}
		return
	}
	w.enqueueLow(msg)
}

func (w *aiSinkWriter) notify(msg aiSinkMsg) error {
	if w == nil || w.notifier == nil {
		return errors.New("nil notifier")
	}
	return w.notifier.Notify(msg.TypeID, msg.Payload)
}

func (w *aiSinkWriter) enqueueLow(msg aiSinkMsg) {
	if w == nil {
		return
	}
	shouldWake := false
	w.mu.Lock()
	key := msg.lowKey
	if key == "" {
		w.lowSeq++
		key = "low\x00" + strconv.FormatUint(w.lowSeq, 10)
		msg.lowKey = key
	}
	if existing, ok := w.lowPending[key]; ok {
		w.lowPending[key] = mergeAISinkLowMsg(existing, msg)
	} else {
		w.lowPending[key] = msg
		w.lowOrder = append(w.lowOrder, key)
		shouldWake = true
	}
	w.mu.Unlock()
	if shouldWake {
		w.signalLowWake()
	}
}

func (w *aiSinkWriter) popLow() (aiSinkMsg, bool) {
	if w == nil {
		return aiSinkMsg{}, false
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	for len(w.lowOrder) > 0 {
		key := w.lowOrder[0]
		w.lowOrder = w.lowOrder[1:]
		msg, ok := w.lowPending[key]
		if !ok {
			continue
		}
		delete(w.lowPending, key)
		return msg, true
	}
	return aiSinkMsg{}, false
}

func (w *aiSinkWriter) signalLowWake() {
	if w == nil {
		return
	}
	select {
	case <-w.stop:
		return
	default:
	}
	select {
	case w.loWake <- struct{}{}:
	default:
	}
}

func (w *aiSinkWriter) Close() {
	if w == nil {
		return
	}
	w.once.Do(func() {
		close(w.stop)
	})
	<-w.done
}
