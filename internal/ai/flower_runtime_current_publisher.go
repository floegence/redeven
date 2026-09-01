package ai

import (
	"strconv"
	"strings"
	"sync"
	"time"

	flruntime "github.com/floegence/floret/v7/runtime"
)

const flowerRuntimeCurrentPublishInterval = 50 * time.Millisecond

type flowerRuntimePublishTimer interface {
	Stop() bool
}

type flowerRuntimePublishClock interface {
	Now() time.Time
	AfterFunc(time.Duration, func()) flowerRuntimePublishTimer
}

type systemFlowerRuntimePublishClock struct{}

func (systemFlowerRuntimePublishClock) Now() time.Time {
	return time.Now()
}

func (systemFlowerRuntimePublishClock) AfterFunc(delay time.Duration, fn func()) flowerRuntimePublishTimer {
	return time.AfterFunc(delay, fn)
}

type flowerRuntimeCurrentPublication struct {
	endpointID string
	current    flruntime.ThreadView
	boundary   string
}

type flowerRuntimeCurrentPublishState struct {
	deliveryMu             sync.Mutex
	latestVersion          uint64
	publishedVersion       uint64
	publishedBoundary      string
	lastPublishedAt        time.Time
	lastDeliveredAt        time.Time
	pending                *flowerRuntimeCurrentPublication
	timer                  flowerRuntimePublishTimer
	timerGeneration        uint64
	turnID                 string
	firstThinkingReceived  time.Time
	firstThinkingPublished bool
}

// flowerRuntimeCurrentPublisher is the only cadence boundary between Floret's
// replaceable current views and Flower's workspace stream. It coalesces only
// cumulative text growth; structural and terminal transitions publish at once.
type flowerRuntimeCurrentPublisher struct {
	mu       sync.Mutex
	interval time.Duration
	clock    flowerRuntimePublishClock
	publish  func(string, flruntime.ThreadView)
	states   map[string]*flowerRuntimeCurrentPublishState
	metrics  *flowerLiveMetrics
	closed   bool
}

func newFlowerRuntimeCurrentPublisher(
	interval time.Duration,
	clock flowerRuntimePublishClock,
	publish func(string, flruntime.ThreadView),
) *flowerRuntimeCurrentPublisher {
	if interval <= 0 {
		interval = flowerRuntimeCurrentPublishInterval
	}
	if clock == nil {
		clock = systemFlowerRuntimePublishClock{}
	}
	return &flowerRuntimeCurrentPublisher{
		interval: interval,
		clock:    clock,
		publish:  publish,
		states:   make(map[string]*flowerRuntimeCurrentPublishState),
	}
}

func (publisher *flowerRuntimeCurrentPublisher) Publish(endpointID string, current flruntime.ThreadView) {
	if publisher == nil || publisher.publish == nil {
		return
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID := strings.TrimSpace(current.ThreadID.String())
	if endpointID == "" || threadID == "" || current.ViewVersion == 0 {
		return
	}
	now := publisher.clock.Now()
	publication := flowerRuntimeCurrentPublication{
		endpointID: endpointID,
		current:    current,
		boundary:   flowerRuntimeCurrentBoundaryKey(current),
	}

	publisher.mu.Lock()
	if publisher.closed {
		publisher.mu.Unlock()
		return
	}
	state := publisher.states[threadID]
	if state == nil {
		state = &flowerRuntimeCurrentPublishState{}
		publisher.states[threadID] = state
	}
	if current.ViewVersion <= state.latestVersion {
		publisher.mu.Unlock()
		return
	}
	state.latestVersion = current.ViewVersion
	if publisher.metrics != nil {
		publisher.metrics.runtimeCurrentReceived()
	}
	if turnID := strings.TrimSpace(current.TurnID.String()); turnID != "" && turnID != state.turnID {
		state.turnID = turnID
		state.firstThinkingReceived = time.Time{}
		state.firstThinkingPublished = false
		state.lastDeliveredAt = time.Time{}
	}
	if state.firstThinkingReceived.IsZero() && flowerRuntimeCurrentHasLiveThinking(current) {
		state.firstThinkingReceived = now
	}

	immediate := state.publishedVersion == 0 || publication.boundary != state.publishedBoundary
	if !immediate && !state.lastPublishedAt.IsZero() && !now.Before(state.lastPublishedAt.Add(publisher.interval)) {
		immediate = true
	}
	if immediate {
		if state.pending != nil && publisher.metrics != nil {
			publisher.metrics.runtimeCurrentCoalesced()
		}
		publisher.cancelTimerLocked(state)
		state.pending = nil
		publisher.recordPublishedLocked(state, publication, now)
		publisher.mu.Unlock()
		publisher.deliver(threadID, state, publication)
		return
	}

	if state.pending != nil && publisher.metrics != nil {
		publisher.metrics.runtimeCurrentCoalesced()
	}
	state.pending = &publication
	if state.timer == nil {
		delay := state.lastPublishedAt.Add(publisher.interval).Sub(now)
		if delay < 0 {
			delay = 0
		}
		state.timerGeneration++
		generation := state.timerGeneration
		state.timer = publisher.clock.AfterFunc(delay, func() {
			publisher.flush(threadID, generation)
		})
	}
	publisher.mu.Unlock()
}

func (publisher *flowerRuntimeCurrentPublisher) flush(threadID string, generation uint64) {
	if publisher == nil {
		return
	}
	publisher.mu.Lock()
	state := publisher.states[threadID]
	if publisher.closed || state == nil || generation != state.timerGeneration {
		publisher.mu.Unlock()
		return
	}
	state.timer = nil
	publication := state.pending
	state.pending = nil
	if publication == nil || publication.current.ViewVersion <= state.publishedVersion {
		publisher.mu.Unlock()
		return
	}
	publisher.recordPublishedLocked(state, *publication, publisher.clock.Now())
	publisher.mu.Unlock()
	publisher.deliver(threadID, state, *publication)
}

func (publisher *flowerRuntimeCurrentPublisher) recordPublishedLocked(
	state *flowerRuntimeCurrentPublishState,
	publication flowerRuntimeCurrentPublication,
	now time.Time,
) {
	state.publishedVersion = publication.current.ViewVersion
	state.publishedBoundary = publication.boundary
	state.lastPublishedAt = now
}

func (publisher *flowerRuntimeCurrentPublisher) deliver(
	threadID string,
	state *flowerRuntimeCurrentPublishState,
	publication flowerRuntimeCurrentPublication,
) {
	state.deliveryMu.Lock()
	defer state.deliveryMu.Unlock()
	publisher.mu.Lock()
	if publisher.closed || publisher.states[threadID] != state || publication.current.ViewVersion != state.publishedVersion {
		publisher.mu.Unlock()
		return
	}
	now := publisher.clock.Now()
	if publisher.metrics != nil {
		publisher.metrics.runtimeCurrentPublished()
		if !state.lastDeliveredAt.IsZero() {
			publisher.metrics.runtimeCurrentPublishGap(now.Sub(state.lastDeliveredAt))
		}
		if !state.firstThinkingPublished && !state.firstThinkingReceived.IsZero() && flowerRuntimeCurrentHasLiveThinking(publication.current) {
			state.firstThinkingPublished = true
			publisher.metrics.runtimeFirstThinkingPublishLatency(now.Sub(state.firstThinkingReceived))
		}
	}
	if publication.current.Activity == flruntime.ThreadActivityActive {
		state.lastDeliveredAt = now
	} else {
		state.lastDeliveredAt = time.Time{}
	}
	publisher.mu.Unlock()
	publisher.publish(publication.endpointID, publication.current)
}

func (publisher *flowerRuntimeCurrentPublisher) cancelTimerLocked(state *flowerRuntimeCurrentPublishState) {
	state.timerGeneration++
	if state.timer != nil {
		state.timer.Stop()
		state.timer = nil
	}
}

func (publisher *flowerRuntimeCurrentPublisher) Forget(threadID string) {
	if publisher == nil {
		return
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return
	}
	publisher.mu.Lock()
	if state := publisher.states[threadID]; state != nil {
		publisher.cancelTimerLocked(state)
		delete(publisher.states, threadID)
	}
	publisher.mu.Unlock()
}

func (publisher *flowerRuntimeCurrentPublisher) Close() {
	if publisher == nil {
		return
	}
	publisher.mu.Lock()
	if publisher.closed {
		publisher.mu.Unlock()
		return
	}
	publisher.closed = true
	for _, state := range publisher.states {
		publisher.cancelTimerLocked(state)
	}
	publisher.states = nil
	publisher.mu.Unlock()
}

func flowerRuntimeCurrentHasLiveThinking(current flruntime.ThreadView) bool {
	for _, item := range current.Items {
		if item.Kind == flruntime.ThreadItemThinking && item.Live && strings.TrimSpace(item.Text) != "" {
			return true
		}
	}
	return false
}

type flowerRuntimeBoundaryBuilder struct {
	strings.Builder
}

func (builder *flowerRuntimeBoundaryBuilder) add(value string) {
	builder.WriteString(strconv.Itoa(len(value)))
	builder.WriteByte(':')
	builder.WriteString(value)
	builder.WriteByte('|')
}

func (builder *flowerRuntimeBoundaryBuilder) addBool(value bool) {
	if value {
		builder.add("1")
		return
	}
	builder.add("0")
}

func (builder *flowerRuntimeBoundaryBuilder) addInt(value int64) {
	builder.add(strconv.FormatInt(value, 10))
}

func flowerRuntimeCurrentBoundaryKey(current flruntime.ThreadView) string {
	var builder flowerRuntimeBoundaryBuilder
	builder.add(string(current.Activity))
	builder.add(current.TurnID.String())
	builder.add(current.RunID.String())
	if current.RunProgress != nil {
		builder.add(string(current.RunProgress.Phase))
	} else {
		builder.add("")
	}
	builder.addInt(int64(current.Attention.ApprovalCount))
	builder.addInt(int64(current.Attention.InputCount))
	if current.LastOutcome != nil {
		builder.add(string(*current.LastOutcome))
	} else {
		builder.add("")
	}
	if current.Failure != nil {
		builder.add(string(current.Failure.Code))
		builder.add(current.Failure.Message)
	} else {
		builder.add("")
		builder.add("")
	}
	builder.addInt(int64(len(current.Items)))
	for _, item := range current.Items {
		builder.add(item.ID)
		builder.add(item.TurnID.String())
		builder.addInt(int64(item.Ordinal))
		builder.add(string(item.Kind))
		builder.addBool(item.Live)
		builder.addBool(strings.TrimSpace(item.Text) != "")
		builder.addInt(int64(len(item.Attachments)))
		builder.addInt(int64(len(item.References)))
		if item.Activity != nil {
			builder.add(item.Activity.ItemID)
			builder.add(item.Activity.ToolID)
			builder.add(item.Activity.ToolName)
			builder.add(string(item.Activity.Kind))
			builder.add(string(item.Activity.Status))
			builder.add(string(item.Activity.Severity))
			builder.addBool(item.Activity.NeedsAttention)
			builder.addBool(item.Activity.RequiresApproval)
			builder.add(item.Activity.ApprovalState)
		} else {
			builder.add("")
		}
		flowerRuntimeInteractionBoundary(&builder, item.Interaction)
	}
	builder.addInt(int64(len(current.Queue)))
	for _, queued := range current.Queue {
		builder.add(queued.ID)
		builder.add(queued.RequestKey)
	}
	builder.addInt(int64(len(current.Interactions)))
	for index := range current.Interactions {
		flowerRuntimeInteractionBoundary(&builder, &current.Interactions[index])
	}
	return builder.String()
}

func flowerRuntimeInteractionBoundary(builder *flowerRuntimeBoundaryBuilder, interaction *flruntime.ThreadInteraction) {
	if interaction == nil {
		builder.add("")
		return
	}
	builder.add(interaction.ID)
	builder.add(interaction.TurnID.String())
	builder.add(string(interaction.Kind))
	builder.add(interaction.ToolCallID)
	builder.addBool(interaction.Resolved)
	if interaction.Approved == nil {
		builder.add("")
	} else {
		builder.addBool(*interaction.Approved)
	}
	if interaction.Resolution == nil {
		builder.add("")
	} else {
		builder.addBool(interaction.Resolution.Accepted)
		builder.addBool(interaction.Resolution.Redacted)
		builder.add(interaction.Resolution.Outcome)
	}
}
