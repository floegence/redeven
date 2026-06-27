package ai

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
)

type floretThreadProjectionOptions struct {
	ActivityTimeline observation.ActivityTimeline
	FileActions      map[string]FlowerActivityFileAction
}

const floretThreadDetailEventPageLimit = 500

func listFloretThreadDetailEventsForTurn(ctx context.Context, host flruntime.Host, threadID flruntime.ThreadID, turnID flruntime.TurnID) ([]flruntime.ThreadDetailEvent, error) {
	if host == nil {
		return nil, fmt.Errorf("floret host is nil")
	}
	var out []flruntime.ThreadDetailEvent
	var afterOrdinal int64
	for {
		detail, err := host.ListThreadDetailEvents(ctx, flruntime.ListThreadDetailEventsRequest{
			ThreadID:     threadID,
			AfterOrdinal: afterOrdinal,
			Limit:        floretThreadDetailEventPageLimit,
			IncludeRaw:   true,
		})
		if err != nil {
			return nil, err
		}
		out = append(out, floretThreadDetailEventsForTurn(detail.Events, turnID)...)
		if !detail.HasMore {
			return out, nil
		}
		if detail.NextOrdinal <= afterOrdinal {
			return nil, fmt.Errorf("floret thread detail pagination did not advance after ordinal %d", afterOrdinal)
		}
		afterOrdinal = detail.NextOrdinal
	}
}

func floretThreadDetailEventsForTurn(events []flruntime.ThreadDetailEvent, turnID flruntime.TurnID) []flruntime.ThreadDetailEvent {
	if len(events) == 0 {
		return nil
	}
	turnIDText := strings.TrimSpace(string(turnID))
	if turnIDText == "" {
		return nil
	}
	out := make([]flruntime.ThreadDetailEvent, 0, len(events))
	for _, ev := range events {
		if strings.TrimSpace(string(ev.TurnID)) != turnIDText {
			continue
		}
		out = append(out, ev)
	}
	return out
}

func flowerBlocksFromFloretThreadEvents(events []flruntime.ThreadDetailEvent, opts floretThreadProjectionOptions) []any {
	blocks := make([]any, 0, len(events))
	var text strings.Builder
	pendingToolIDs := make([]string, 0)
	pendingToolSet := map[string]struct{}{}
	flushText := func() {
		content := text.String()
		if strings.TrimSpace(content) == "" {
			text.Reset()
			return
		}
		blocks = append(blocks, &persistedMarkdownBlock{Type: "markdown", Content: content})
		text.Reset()
	}
	flushActivity := func() {
		if len(pendingToolIDs) == 0 {
			return
		}
		timeline := floretActivityTimelineForToolIDs(opts.ActivityTimeline, pendingToolSet)
		if len(timeline.Items) > 0 {
			blocks = append(blocks, newActivityTimelineBlock(timeline, opts.FileActions))
		}
		pendingToolIDs = pendingToolIDs[:0]
		pendingToolSet = map[string]struct{}{}
	}
	addTool := func(toolID string) {
		toolID = strings.TrimSpace(toolID)
		if toolID == "" {
			return
		}
		if _, ok := pendingToolSet[toolID]; ok {
			return
		}
		pendingToolSet[toolID] = struct{}{}
		pendingToolIDs = append(pendingToolIDs, toolID)
	}
	for _, ev := range events {
		switch ev.Kind {
		case flruntime.ThreadDetailEventAssistantMessage:
			content := floretThreadAssistantText(ev)
			if strings.TrimSpace(content) == "" {
				continue
			}
			flushActivity()
			text.WriteString(content)
		case flruntime.ThreadDetailEventToolCall:
			if ev.ToolCall == nil {
				continue
			}
			flushText()
			addTool(ev.ToolCall.ID)
		case flruntime.ThreadDetailEventToolResult:
			if ev.ToolResult == nil {
				continue
			}
			flushText()
			addTool(ev.ToolResult.CallID)
		}
	}
	flushText()
	flushActivity()
	return blocks
}

func floretThreadAssistantText(ev flruntime.ThreadDetailEvent) string {
	if ev.Message == nil {
		return ""
	}
	if text := strings.TrimSpace(ev.Message.Content); text != "" {
		return ev.Message.Content
	}
	return ev.Message.Preview
}

func floretActivityTimelineForToolIDs(timeline observation.ActivityTimeline, toolIDs map[string]struct{}) observation.ActivityTimeline {
	if len(timeline.Items) == 0 || len(toolIDs) == 0 {
		return observation.ActivityTimeline{}
	}
	items := make([]observation.ActivityItem, 0, len(timeline.Items))
	for _, item := range timeline.Items {
		toolID := strings.TrimSpace(item.ToolID)
		if toolID == "" {
			toolID = strings.TrimSpace(item.ItemID)
		}
		if _, ok := toolIDs[toolID]; ok {
			items = append(items, item)
		}
	}
	if len(items) == 0 {
		return observation.ActivityTimeline{}
	}
	timeline.Items = items
	timeline.Summary = activityTimelineSummaryFromItems(timeline.Summary, items)
	return timeline
}

func (r *run) applyFloretThreadDetailProjection(events []flruntime.ThreadDetailEvent, timeline observation.ActivityTimeline) bool {
	if r == nil {
		return false
	}
	if !r.acceptsPresentationUpdates() {
		return false
	}
	fileActions := r.activityTimelineFileActions(timeline)
	blocks := flowerBlocksFromFloretThreadEvents(events, floretThreadProjectionOptions{
		ActivityTimeline: r.normalizeActivityTimeline(timeline),
		FileActions:      fileActions,
	})
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
	r.activitySegmentEvents = nil
	r.activityTimelineProjected = containsActivityTimelineBlock(blocks)
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
	activityEvents := append([]observation.Event(nil), r.activityTimelineEvents...)
	r.muAssistant.Unlock()
	if len(events) == 0 {
		return false
	}
	timeline := observation.BuildActivityTimeline(r.activityRunMeta(), activityEvents, time.Now().UnixMilli())
	return r.applyFloretThreadDetailProjection(events, timeline)
}

func containsActivityTimelineBlock(blocks []any) bool {
	for _, block := range blocks {
		if isActivityTimelineBlockValue(block) {
			return true
		}
	}
	return false
}

func (r *run) hasFloretThreadDetailProjectionApplied() bool {
	if r == nil {
		return false
	}
	r.muAssistant.Lock()
	defer r.muAssistant.Unlock()
	return r.floretThreadProjectionApplied
}
