package ai

import (
	"encoding/json"
	"sync"
	"testing"
	"time"
)

type sinkTestNotification struct {
	typeID  uint32
	payload json.RawMessage
}

type sinkTestNotifier struct {
	blockFirst bool

	startOnce   sync.Once
	releaseOnce sync.Once
	startedCh   chan struct{}
	releaseCh   chan struct{}

	mu            sync.Mutex
	notifications []sinkTestNotification
}

func newSinkTestNotifier(blockFirst bool) *sinkTestNotifier {
	return &sinkTestNotifier{
		blockFirst: blockFirst,
		startedCh:  make(chan struct{}),
		releaseCh:  make(chan struct{}),
	}
}

func (n *sinkTestNotifier) Notify(typeID uint32, payload json.RawMessage) error {
	if n.blockFirst {
		n.startOnce.Do(func() {
			close(n.startedCh)
			<-n.releaseCh
		})
	}
	n.mu.Lock()
	defer n.mu.Unlock()
	n.notifications = append(n.notifications, sinkTestNotification{
		typeID:  typeID,
		payload: append(json.RawMessage(nil), payload...),
	})
	return nil
}

func (n *sinkTestNotifier) waitFirstStarted(t *testing.T) {
	t.Helper()
	select {
	case <-n.startedCh:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for first notify to start")
	}
}

func (n *sinkTestNotifier) releaseFirst() {
	n.releaseOnce.Do(func() {
		close(n.releaseCh)
	})
}

func (n *sinkTestNotifier) snapshot() []sinkTestNotification {
	n.mu.Lock()
	defer n.mu.Unlock()
	out := make([]sinkTestNotification, len(n.notifications))
	copy(out, n.notifications)
	return out
}

func waitForSinkCondition(t *testing.T, desc string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", desc)
}

func mustMarshalSinkEvent(t *testing.T, ev RealtimeEvent) json.RawMessage {
	t.Helper()
	payload, err := json.Marshal(ev)
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	return payload
}

func makeSinkBlockDeltaMsg(t *testing.T, at int64, delta string) aiSinkMsg {
	t.Helper()
	ev := RealtimeEvent{
		EventType:   RealtimeEventTypeStream,
		EndpointID:  "env_test",
		ThreadID:    "thread_test",
		RunID:       "run_test",
		AtUnixMs:    at,
		StreamKind:  RealtimeStreamKindAssistant,
		StreamEvent: streamEventBlockDelta{Type: "block-delta", MessageID: "msg_reasoning", BlockIndex: 0, Delta: delta},
	}
	return newAISinkMsg(TypeID_AI_EVENT_NOTIFY, ev, mustMarshalSinkEvent(t, ev))
}

func makeSinkContextUsageMsg(t *testing.T, at int64, step int) aiSinkMsg {
	t.Helper()
	ev := RealtimeEvent{
		EventType:   RealtimeEventTypeStream,
		EndpointID:  "env_test",
		ThreadID:    "thread_test",
		RunID:       "run_test",
		AtUnixMs:    at,
		StreamKind:  RealtimeStreamKindContext,
		StreamEvent: streamEventContextUsage{Type: "context-usage", Payload: map[string]any{"step": step}},
	}
	return newAISinkMsg(TypeID_AI_EVENT_NOTIFY, ev, mustMarshalSinkEvent(t, ev))
}

func makeSinkThreadStateMsg(t *testing.T, status string) aiSinkMsg {
	t.Helper()
	ev := RealtimeEvent{
		EventType:  RealtimeEventTypeThreadState,
		EndpointID: "env_test",
		ThreadID:   "thread_test",
		RunID:      "run_test",
		AtUnixMs:   time.Now().UnixMilli(),
		RunStatus:  status,
		StreamKind: RealtimeStreamKindLifecycle,
		Phase:      RealtimePhaseStateChange,
	}
	return newAISinkMsg(TypeID_AI_EVENT_NOTIFY, ev, mustMarshalSinkEvent(t, ev))
}

func decodeSinkBlockDelta(t *testing.T, payload json.RawMessage) streamEventBlockDelta {
	t.Helper()
	var env struct {
		StreamEvent streamEventBlockDelta `json:"stream_event"`
	}
	if err := json.Unmarshal(payload, &env); err != nil {
		t.Fatalf("json.Unmarshal block delta: %v", err)
	}
	return env.StreamEvent
}

func decodeSinkContextUsage(t *testing.T, payload json.RawMessage) streamEventContextUsage {
	t.Helper()
	var env struct {
		StreamEvent streamEventContextUsage `json:"stream_event"`
	}
	if err := json.Unmarshal(payload, &env); err != nil {
		t.Fatalf("json.Unmarshal context usage: %v", err)
	}
	return env.StreamEvent
}

func decodeSinkEventType(t *testing.T, payload json.RawMessage) RealtimeEventType {
	t.Helper()
	var env struct {
		EventType RealtimeEventType `json:"event_type"`
	}
	if err := json.Unmarshal(payload, &env); err != nil {
		t.Fatalf("json.Unmarshal event type: %v", err)
	}
	return env.EventType
}

func TestAISinkWriter_CoalescesBlockDeltaContentWithoutLoss(t *testing.T) {
	t.Parallel()

	notifier := newSinkTestNotifier(true)
	writer := newAISinkWriterWithNotifier(notifier)
	defer func() {
		notifier.releaseFirst()
		writer.Close()
	}()

	writer.TrySend(aiSinkPriorityLow, makeSinkBlockDeltaMsg(t, 1, "A"))
	notifier.waitFirstStarted(t)

	want := "A"
	for i, part := range []string{"B", "C", "D", "E", "F"} {
		writer.TrySend(aiSinkPriorityLow, makeSinkBlockDeltaMsg(t, int64(i+2), part))
		want += part
	}

	writer.mu.Lock()
	if got := len(writer.lowPending); got != 1 {
		writer.mu.Unlock()
		t.Fatalf("lowPending=%d, want 1", got)
	}
	if got := len(writer.lowOrder); got != 1 {
		writer.mu.Unlock()
		t.Fatalf("lowOrder=%d, want 1", got)
	}
	var pending aiSinkMsg
	for _, msg := range writer.lowPending {
		pending = msg
		break
	}
	writer.mu.Unlock()

	if got := decodeSinkBlockDelta(t, pending.Payload).Delta; got != "BCDEF" {
		t.Fatalf("pending block delta=%q, want %q", got, "BCDEF")
	}

	notifier.releaseFirst()
	waitForSinkCondition(t, "merged block-delta delivery", func() bool {
		notifications := notifier.snapshot()
		if len(notifications) < 2 {
			return false
		}
		var merged string
		for _, it := range notifications {
			merged += decodeSinkBlockDelta(t, it.payload).Delta
		}
		return merged == want
	})

	notifications := notifier.snapshot()
	var got string
	for _, it := range notifications {
		got += decodeSinkBlockDelta(t, it.payload).Delta
	}
	if got != want {
		t.Fatalf("combined block delta=%q, want %q", got, want)
	}
}

func TestAISinkWriter_HighPriorityStillPreemptsCoalescedLowBacklog(t *testing.T) {
	t.Parallel()

	notifier := newSinkTestNotifier(true)
	writer := newAISinkWriterWithNotifier(notifier)
	defer func() {
		notifier.releaseFirst()
		writer.Close()
	}()

	writer.TrySend(aiSinkPriorityLow, makeSinkBlockDeltaMsg(t, 1, "A"))
	notifier.waitFirstStarted(t)

	writer.TrySend(aiSinkPriorityLow, makeSinkBlockDeltaMsg(t, 2, "B"))
	writer.TrySend(aiSinkPriorityLow, makeSinkBlockDeltaMsg(t, 3, "C"))
	writer.TrySend(aiSinkPriorityHigh, makeSinkThreadStateMsg(t, string(RunStateRunning)))

	notifier.releaseFirst()
	waitForSinkCondition(t, "high-priority delivery ahead of low backlog", func() bool {
		return len(notifier.snapshot()) >= 3
	})

	notifications := notifier.snapshot()
	if got := decodeSinkBlockDelta(t, notifications[0].payload).Delta; got != "A" {
		t.Fatalf("notification[0] delta=%q, want A", got)
	}
	if got := decodeSinkEventType(t, notifications[1].payload); got != RealtimeEventTypeThreadState {
		t.Fatalf("notification[1] event_type=%q, want %q", got, RealtimeEventTypeThreadState)
	}
	if got := decodeSinkBlockDelta(t, notifications[2].payload).Delta; got != "BC" {
		t.Fatalf("notification[2] delta=%q, want BC", got)
	}
}

func TestAISinkWriter_ContextUsageKeepsLatestLowPrioritySnapshot(t *testing.T) {
	t.Parallel()

	notifier := newSinkTestNotifier(true)
	writer := newAISinkWriterWithNotifier(notifier)
	defer func() {
		notifier.releaseFirst()
		writer.Close()
	}()

	writer.TrySend(aiSinkPriorityLow, makeSinkContextUsageMsg(t, 1, 1))
	notifier.waitFirstStarted(t)

	writer.TrySend(aiSinkPriorityLow, makeSinkContextUsageMsg(t, 2, 2))
	writer.TrySend(aiSinkPriorityLow, makeSinkContextUsageMsg(t, 3, 3))

	writer.mu.Lock()
	if got := len(writer.lowPending); got != 1 {
		writer.mu.Unlock()
		t.Fatalf("lowPending=%d, want 1", got)
	}
	var pending aiSinkMsg
	for _, msg := range writer.lowPending {
		pending = msg
		break
	}
	writer.mu.Unlock()

	if pending.lowBlock != nil {
		t.Fatalf("pending lowBlock unexpected for context usage")
	}
	if got := int(decodeSinkContextUsage(t, pending.Payload).Payload["step"].(float64)); got != 3 {
		t.Fatalf("pending context step=%d, want 3", got)
	}

	notifier.releaseFirst()
	waitForSinkCondition(t, "latest context-usage delivery", func() bool {
		return len(notifier.snapshot()) >= 2
	})

	notifications := notifier.snapshot()
	if got := int(decodeSinkContextUsage(t, notifications[1].payload).Payload["step"].(float64)); got != 3 {
		t.Fatalf("delivered context step=%d, want 3", got)
	}
}
