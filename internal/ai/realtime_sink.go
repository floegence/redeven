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
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
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
	if ev.EventType != RealtimeEventTypeThreadSummary && ev.RunID == "" {
		return
	}
	if ev.AtUnixMs <= 0 {
		ev.AtUnixMs = time.Now().UnixMilli()
	}
	s.publishFlowerLiveEventFromRealtime(ev)

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
	case streamEventModelIOStatus:
		return RealtimeStreamKindLifecycle
	case streamEventApprovalAction:
		return RealtimeStreamKindTool
	case streamEventBlockStart:
		switch strings.TrimSpace(strings.ToLower(ev.BlockType)) {
		case activityTimelineBlockType:
			return RealtimeStreamKindTool
		}
		return RealtimeStreamKindAssistant
	case streamEventBlockSet:
		blockMap, ok := ev.Block.(map[string]any)
		if ok {
			switch t, _ := blockMap["type"].(string); strings.TrimSpace(strings.ToLower(t)) {
			case activityTimelineBlockType:
				return RealtimeStreamKindTool
			}
		}
		if _, ok := ev.Block.(ActivityTimelineBlock); ok {
			return RealtimeStreamKindTool
		}
		if _, ok := ev.Block.(*ActivityTimelineBlock); ok {
			return RealtimeStreamKindTool
		}
		return RealtimeStreamKindAssistant
	default:
		return RealtimeStreamKindAssistant
	}
}

func (s *Service) broadcastThreadState(endpointID string, threadID string, runID string, runStatus string, runErrCode string, runErr string) {
	runStatus = strings.TrimSpace(runStatus)
	runErrCode = strings.TrimSpace(runErrCode)
	runErr = strings.TrimSpace(runErr)
	var waitingPrompt *RequestUserInputPrompt
	if s != nil {
		timeout := s.persistOpTO
		if timeout <= 0 {
			timeout = defaultPersistOpTimeout
		}
		ctx, cancel := context.WithTimeout(context.Background(), timeout)
		_, latest, err := s.readCanonicalThreadState(ctx, threadID)
		cancel()
		if err == nil {
			waitingPrompt, _ = requestUserInputPromptFromFloretTurn(latest)
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
			"run_status":     runStatus,
			"run_error_code": runErrCode,
		},
		RunStatus:     runStatus,
		RunErrorCode:  runErrCode,
		RunError:      runErr,
		WaitingPrompt: waitingPrompt,
	}
	s.broadcastRealtimeEvent(ev)
}

func (s *Service) broadcastStreamEvent(endpointID string, threadID string, turnID string, runID string, streamEvent any) {
	publicStreamEvent, ok := sanitizePublicStreamEvent(streamEvent)
	if !ok {
		return
	}
	ev := RealtimeEvent{
		EventType:   RealtimeEventTypeStream,
		EndpointID:  strings.TrimSpace(endpointID),
		ThreadID:    strings.TrimSpace(threadID),
		TurnID:      strings.TrimSpace(turnID),
		RunID:       strings.TrimSpace(runID),
		AtUnixMs:    time.Now().UnixMilli(),
		StreamKind:  classifyStreamKind(publicStreamEvent),
		StreamEvent: publicStreamEvent,
	}
	s.broadcastRealtimeEvent(ev)
	if isFlowerReadActivityStreamEvent(publicStreamEvent) {
		s.broadcastThreadSummary(endpointID, threadID)
	}
}

func isFlowerReadActivityStreamEvent(streamEvent any) bool {
	switch streamEvent.(type) {
	case streamEventContextUsage, streamEventContextCompaction:
		return true
	default:
		return false
	}
}

func (s *Service) broadcastThreadSummary(endpointID string, threadID string) {
	_ = s.broadcastThreadSummaryChecked(endpointID, threadID)
}

func (s *Service) broadcastThreadSummaryChecked(endpointID string, threadID string) error {
	ev, err := s.threadSummaryRealtimeEvent(endpointID, threadID)
	if err != nil {
		return err
	}
	s.broadcastRealtimeEvent(ev)
	return nil
}

func (s *Service) threadSummaryRealtimeEvent(endpointID string, threadID string) (RealtimeEvent, error) {
	if s == nil {
		return RealtimeEvent{}, errors.New("nil service")
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return RealtimeEvent{}, errors.New("invalid thread summary identity")
	}

	s.mu.Lock()
	db := s.threadsDB
	persistTO := s.persistOpTO
	s.mu.Unlock()
	if db == nil {
		return RealtimeEvent{}, errors.New("threads store not ready")
	}
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}

	ctx, cancel := context.WithTimeout(context.Background(), persistTO)
	defer cancel()
	th, err := db.GetThreadSettings(ctx, endpointID, threadID)
	if err != nil {
		return RealtimeEvent{}, err
	}
	if th == nil {
		return RealtimeEvent{}, errors.New("thread summary target not found")
	}
	queuedTurnCount, countErr := db.CountFollowupsByLane(ctx, endpointID, threadID, threadstore.FollowupLaneQueued)
	if countErr != nil {
		return RealtimeEvent{}, countErr
	}

	snapshot, latest, err := s.readCanonicalThreadState(ctx, threadID)
	if err != nil {
		return RealtimeEvent{}, err
	}
	runStatus, runErrorCode, runError, err := threadViewRunState(snapshot, latest)
	if err != nil {
		return RealtimeEvent{}, err
	}
	permissionType, err := threadPermissionType(th)
	if err != nil {
		return RealtimeEvent{}, err
	}
	waitingPrompt, err := requestUserInputPromptFromFloretTurn(latest)
	if err != nil {
		return RealtimeEvent{}, err
	}
	lastMessageAt, lastMessagePreview := canonicalThreadPreview(latest)
	reasoningCapability, _, _, err := s.threadReasoningDefaults(ctx, strings.TrimSpace(th.ModelID))
	if err != nil {
		return RealtimeEvent{}, err
	}
	reasoningSelection, err := parseStoredReasoningSelection(th.ReasoningSelectionJSON)
	if err != nil {
		return RealtimeEvent{}, err
	}
	if err := config.ValidateAIReasoningSelection(reasoningCapability, reasoningSelection); err != nil {
		return RealtimeEvent{}, reasoningSelectionError(strings.TrimSpace(th.ModelID), err)
	}

	return RealtimeEvent{
		EventType:           RealtimeEventTypeThreadSummary,
		EndpointID:          endpointID,
		ThreadID:            threadID,
		RunID:               "",
		AtUnixMs:            time.Now().UnixMilli(),
		RunStatus:           runStatus,
		RunErrorCode:        runErrorCode,
		RunError:            runError,
		Title:               strings.TrimSpace(snapshot.Title),
		ModelID:             strings.TrimSpace(th.ModelID),
		UpdatedAtUnixMs:     snapshot.UpdatedAt.UnixMilli(),
		LastMessagePreview:  lastMessagePreview,
		LastMessageAtUnixMs: lastMessageAt,
		ActiveRunID:         strings.TrimSpace(string(snapshot.LatestRunID)),
		PermissionType:      permissionTypeString(permissionType),
		QueuedTurnCount:     queuedTurnCount,
		ReasoningSelection:  reasoningSelection,
		ReasoningCapability: reasoningCapability,
		WaitingPrompt:       waitingPrompt,
	}, nil
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

		// Drain all low-priority messages eagerly to keep the coalesce window small.
		// Still check for high-priority messages between pops so they can preempt.
		drained := false
		for {
			msg, ok := w.popLow()
			if !ok {
				break
			}
			drained = true
			if err := w.notify(msg); err != nil {
				return
			}
			// Allow high-priority messages to preempt between low-priority notifications.
			select {
			case hiMsg := <-w.hiCh:
				if err := w.notify(hiMsg); err != nil {
					return
				}
			default:
			}
		}
		if drained {
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
