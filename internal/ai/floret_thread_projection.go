package ai

import (
	"sort"
	"strings"
	"time"

	flruntime "github.com/floegence/floret/runtime"
)

func (r *run) applyFloretThreadProjection(projection flruntime.ThreadTurnProjection) bool {
	if r == nil {
		return false
	}
	if !r.acceptsPresentationUpdates() {
		return false
	}
	blocks := r.flowerBlocksFromFloretThreadProjection(projection)
	if len(blocks) == 0 {
		blocks = []any{&persistedMarkdownBlock{Type: "markdown", Content: ""}}
	}
	r.mu.Lock()
	r.nextBlockIndex = len(blocks)
	r.currentTextBlockIndex = -1
	r.currentThinkingBlockIndex = -1
	r.needNewTextBlock = true
	r.needNewThinkingBlock = true
	r.activitySegmentActive = false
	r.activitySegmentBlockIndex = -1
	r.mu.Unlock()
	r.muAssistant.Lock()
	if r.assistantCreatedAtUnixMs == 0 {
		r.assistantCreatedAtUnixMs = time.Now().UnixMilli()
	}
	oldLen := len(r.assistantBlocks)
	r.assistantBlocks = blocks
	r.floretThreadProjectionApplied = true
	r.muAssistant.Unlock()
	for idx, block := range blocks {
		r.sendStreamEvent(streamEventBlockSet{Type: "block-set", MessageID: r.messageID, BlockIndex: idx, Block: block})
	}
	for idx := len(blocks); idx < oldLen; idx++ {
		r.sendStreamEvent(streamEventBlockSet{
			Type:       "block-set",
			MessageID:  r.messageID,
			BlockIndex: idx,
			Block:      persistedMarkdownBlock{Type: "markdown", Content: ""},
		})
	}
	return true
}

func (r *run) flowerBlocksFromFloretThreadProjection(projection flruntime.ThreadTurnProjection) []any {
	if r == nil || len(projection.Segments) == 0 {
		return nil
	}
	blocks := make([]any, 0, len(projection.Segments))
	for _, segment := range projection.Segments {
		switch segment.Kind {
		case flruntime.ThreadTurnProjectionSegmentAssistantText:
			if strings.TrimSpace(segment.Text) == "" {
				continue
			}
			blocks = append(blocks, &persistedMarkdownBlock{Type: "markdown", Content: segment.Text})
		case flruntime.ThreadTurnProjectionSegmentActivityTimeline:
			if segment.ActivityTimeline == nil || len(segment.ActivityTimeline.Items) == 0 {
				continue
			}
			timeline := r.normalizeActivityTimeline(*segment.ActivityTimeline)
			blocks = append(blocks, newActivityTimelineBlock(timeline, r.activityTimelineFileActions(timeline)))
		case flruntime.ThreadTurnProjectionSegmentControlSignal:
			continue
		}
	}
	return blocks
}

func (r *run) recordFloretCommittedThreadEvent(ev *flruntime.ThreadDetailEvent) {
	if r == nil || ev == nil {
		return
	}
	if !r.acceptsPresentationUpdates() {
		return
	}
	if strings.TrimSpace(string(ev.TurnID)) != strings.TrimSpace(r.messageID) {
		return
	}
	r.muAssistant.Lock()
	for _, existing := range r.floretCommittedThreadEvents {
		if floretThreadDetailEventsSameEntry(existing, *ev) {
			r.muAssistant.Unlock()
			return
		}
	}
	r.floretCommittedThreadEvents = append(r.floretCommittedThreadEvents, *ev)
	sort.SliceStable(r.floretCommittedThreadEvents, func(i, j int) bool {
		left := r.floretCommittedThreadEvents[i]
		right := r.floretCommittedThreadEvents[j]
		if left.Ordinal != right.Ordinal {
			return left.Ordinal < right.Ordinal
		}
		if !left.CreatedAt.Equal(right.CreatedAt) {
			return left.CreatedAt.Before(right.CreatedAt)
		}
		return left.ID < right.ID
	})
	r.muAssistant.Unlock()
	r.applyCommittedFloretThreadDetailProjection()
}

func floretThreadDetailEventsSameEntry(left flruntime.ThreadDetailEvent, right flruntime.ThreadDetailEvent) bool {
	leftID := strings.TrimSpace(left.ID)
	rightID := strings.TrimSpace(right.ID)
	if leftID != "" && rightID != "" {
		return leftID == rightID
	}
	return left.Ordinal != 0 && left.Ordinal == right.Ordinal
}

func (r *run) applyCommittedFloretThreadDetailProjection() bool {
	if r == nil {
		return false
	}
	if !r.acceptsPresentationUpdates() {
		return false
	}
	r.muAssistant.Lock()
	events := append([]flruntime.ThreadDetailEvent(nil), r.floretCommittedThreadEvents...)
	r.muAssistant.Unlock()
	if len(events) == 0 {
		return false
	}
	projection := flruntime.ProjectThreadTurn(flruntime.ProjectThreadTurnRequest{
		ThreadID: flruntime.ThreadID(strings.TrimSpace(r.threadID)),
		TurnID:   flruntime.TurnID(strings.TrimSpace(r.messageID)),
		RunID:    flruntime.RunID(strings.TrimSpace(r.id)),
		TraceID:  flruntime.TraceID(strings.TrimSpace(r.id)),
		Events:   events,
	})
	return r.applyFloretThreadProjection(projection)
}

func (r *run) hasFloretThreadDetailProjectionApplied() bool {
	if r == nil {
		return false
	}
	r.muAssistant.Lock()
	defer r.muAssistant.Unlock()
	return r.floretThreadProjectionApplied
}
