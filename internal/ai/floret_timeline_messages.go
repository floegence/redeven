package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
)

const floretSyntheticRowIDBase int64 = 1 << 60

type threadTimelineMessage struct {
	RowID       int64
	MessageID   string
	CreatedAt   int64
	SortKey     int64
	SourceRank  int
	MessageJSON json.RawMessage
}

func (s *Service) listThreadTimelineMessages(ctx context.Context, endpointID string, threadID string, limit int, beforeRowID int64) ([]threadTimelineMessage, int64, bool, error) {
	items, err := s.loadThreadTimelineMessages(ctx, endpointID, threadID)
	if err != nil {
		return nil, 0, false, err
	}
	if limit <= 0 {
		limit = 200
	}
	if limit > 500 {
		limit = 500
	}
	end := len(items)
	if beforeRowID != 0 {
		for i, item := range items {
			if item.RowID == beforeRowID {
				end = i
				break
			}
		}
	}
	start := end - limit
	if start < 0 {
		start = 0
	}
	out := append([]threadTimelineMessage(nil), items[start:end]...)
	nextBefore := int64(0)
	hasMore := start > 0
	if hasMore && len(out) > 0 {
		nextBefore = out[0].RowID
	}
	return out, nextBefore, hasMore, nil
}

func (s *Service) listThreadTimelineMessagesAfter(ctx context.Context, endpointID string, threadID string, limit int, afterRowID int64, tail bool) ([]threadTimelineMessage, int64, bool, error) {
	items, err := s.loadThreadTimelineMessages(ctx, endpointID, threadID)
	if err != nil {
		return nil, 0, false, err
	}
	if limit <= 0 {
		limit = 200
	}
	if limit > 500 {
		limit = 500
	}
	start := 0
	if tail {
		if len(items) > limit {
			start = len(items) - limit
		}
	} else if afterRowID != 0 {
		for i, item := range items {
			if item.RowID == afterRowID {
				start = i + 1
				break
			}
		}
	}
	end := start + limit
	if end > len(items) {
		end = len(items)
	}
	out := append([]threadTimelineMessage(nil), items[start:end]...)
	nextAfter := int64(0)
	if len(out) > 0 {
		nextAfter = out[len(out)-1].RowID
	}
	hasMore := end < len(items)
	return out, nextAfter, hasMore, nil
}

func (s *Service) loadThreadTimelineMessages(ctx context.Context, endpointID string, threadID string) ([]threadTimelineMessage, error) {
	if s == nil {
		return nil, errors.New("nil service")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return nil, errors.New("threads store not ready")
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return nil, errors.New("invalid request")
	}

	msgs, err := loadAllThreadTimelineTranscriptMessages(ctx, db, endpointID, threadID)
	if err != nil {
		return nil, err
	}
	persistedRows := make([]struct {
		rowID     int64
		messageID string
		role      string
		createdAt int64
		raw       json.RawMessage
	}, 0, len(msgs))
	persistedAssistantIDs := make(map[string]struct{})
	messageRowIDs := make(map[string]int64)
	maxMessageRowID := int64(0)
	for _, msg := range msgs {
		raw, err := SanitizeActivityTimelineMessageJSON(msg.MessageJSON)
		if err != nil {
			return nil, err
		}
		if len(raw) == 0 {
			continue
		}
		messageID := strings.TrimSpace(msg.MessageID)
		if msg.ID > maxMessageRowID {
			maxMessageRowID = msg.ID
		}
		if messageID != "" {
			messageRowIDs[messageID] = msg.ID
		}
		if strings.TrimSpace(msg.Role) == "assistant" && messageID != "" {
			persistedAssistantIDs[messageID] = struct{}{}
		}
		persistedRows = append(persistedRows, struct {
			rowID     int64
			messageID string
			role      string
			createdAt int64
			raw       json.RawMessage
		}{
			rowID:     msg.ID,
			messageID: messageID,
			role:      msg.Role,
			createdAt: msg.CreatedAtUnixMs,
			raw:       raw,
		})
	}

	turns, err := loadAllThreadTimelineConversationTurns(ctx, db, endpointID, threadID)
	if err != nil {
		return nil, err
	}
	turnSortKeys := make(map[string]int64, len(turns)*2)
	for _, turn := range turns {
		userMessageID := strings.TrimSpace(turn.UserMessageID)
		assistantMessageID := strings.TrimSpace(turn.AssistantMessageID)
		turnID := strings.TrimSpace(turn.TurnID)
		base := int64(0)
		if userMessageID != "" {
			base = messageRowIDs[userMessageID] * 4
		}
		if base <= 0 {
			base = (maxMessageRowID + turn.ID) * 4
		}
		if userMessageID != "" {
			turnSortKeys[userMessageID] = base
		}
		if assistantMessageID != "" {
			turnSortKeys[assistantMessageID] = base + 1
		}
		if turnID != "" {
			turnSortKeys[turnID] = base + 1
		}
	}
	items := make([]threadTimelineMessage, 0, len(persistedRows)+len(turns))
	messageSortKey := func(messageID string, defaultKey int64) int64 {
		if sortKey, ok := turnSortKeys[strings.TrimSpace(messageID)]; ok {
			return sortKey
		}
		return defaultKey
	}
	for _, row := range persistedRows {
		sourceRank := timelineSourceRank(row.role)
		items = append(items, threadTimelineMessage{
			RowID:       row.rowID,
			MessageID:   row.messageID,
			CreatedAt:   row.createdAt,
			SortKey:     messageSortKey(row.messageID, row.rowID*4+int64(sourceRank)),
			SourceRank:  sourceRank,
			MessageJSON: row.raw,
		})
	}
	type projectionTurn struct {
		turn  threadstore.ConversationTurn
		run   *threadstore.RunRecord
		rawID string
	}
	projectionTurns := make([]projectionTurn, 0, len(turns))
	for _, turn := range turns {
		turnID := strings.TrimSpace(turn.TurnID)
		runID := strings.TrimSpace(turn.RunID)
		if turnID == "" || runID == "" {
			continue
		}
		if _, exists := persistedAssistantIDs[turnID]; exists {
			continue
		}
		if assistantID := strings.TrimSpace(turn.AssistantMessageID); assistantID != "" {
			if _, exists := persistedAssistantIDs[assistantID]; exists {
				continue
			}
		}
		run, err := db.GetRun(ctx, endpointID, runID)
		if err != nil {
			return nil, err
		}
		if run != nil && runStateCanLackFloretProjection(run.State) {
			continue
		}
		projectionTurns = append(projectionTurns, projectionTurn{turn: turn, run: run, rawID: turnID})
	}
	var host flruntime.ThreadMaintenanceHost
	if len(projectionTurns) > 0 {
		var hostErr error
		host, hostErr = s.openFloretMaintenanceHost()
		if hostErr != nil {
			return nil, hostErr
		}
		defer host.Close()
	}
	for _, candidate := range projectionTurns {
		raw, createdAt, ok, err := s.floretProjectionMessageJSON(ctx, host, endpointID, threadID, candidate.turn, candidate.run)
		if err != nil {
			return nil, err
		}
		if !ok {
			raw, createdAt, ok, err = missingTerminalProjectionMessageJSON(candidate.turn, candidate.run)
			if err != nil {
				return nil, err
			}
			if !ok {
				return nil, fmt.Errorf("missing Floret projection for terminal turn %q", candidate.rawID)
			}
		}
		items = append(items, threadTimelineMessage{
			RowID:       floretSyntheticRowIDBase + candidate.turn.ID,
			MessageID:   candidate.rawID,
			CreatedAt:   createdAt,
			SortKey:     messageSortKey(candidate.rawID, (maxMessageRowID+candidate.turn.ID)*4+1),
			SourceRank:  1,
			MessageJSON: raw,
		})
	}

	sort.SliceStable(items, func(i, j int) bool {
		left := items[i]
		right := items[j]
		if left.SortKey != right.SortKey {
			return left.SortKey < right.SortKey
		}
		if left.SourceRank != right.SourceRank {
			return left.SourceRank < right.SourceRank
		}
		if left.CreatedAt != right.CreatedAt {
			return left.CreatedAt < right.CreatedAt
		}
		if left.RowID != right.RowID {
			return left.RowID < right.RowID
		}
		return left.MessageID < right.MessageID
	})
	return items, nil
}

func loadAllThreadTimelineTranscriptMessages(ctx context.Context, db *threadstore.Store, endpointID string, threadID string) ([]threadstore.Message, error) {
	if db == nil {
		return nil, errors.New("threads store not ready")
	}
	pages := make([][]threadstore.Message, 0, 1)
	beforeID := int64(0)
	for {
		msgs, nextBeforeID, hasMore, err := db.ListMessages(ctx, endpointID, threadID, 500, beforeID)
		if err != nil {
			return nil, err
		}
		if len(msgs) == 0 {
			break
		}
		pages = append(pages, msgs)
		if !hasMore {
			break
		}
		beforeID = nextBeforeID
	}
	out := make([]threadstore.Message, 0)
	for i := len(pages) - 1; i >= 0; i-- {
		out = append(out, pages[i]...)
	}
	return out, nil
}

func loadAllThreadTimelineConversationTurns(ctx context.Context, db *threadstore.Store, endpointID string, threadID string) ([]threadstore.ConversationTurn, error) {
	if db == nil {
		return nil, errors.New("threads store not ready")
	}
	pages := make([][]threadstore.ConversationTurn, 0, 1)
	beforeID := int64(0)
	for {
		turns, nextBeforeID, hasMore, err := db.ListConversationTurnsBefore(ctx, endpointID, threadID, 500, beforeID)
		if err != nil {
			return nil, err
		}
		if len(turns) == 0 {
			break
		}
		pages = append(pages, turns)
		if !hasMore {
			break
		}
		beforeID = nextBeforeID
	}
	out := make([]threadstore.ConversationTurn, 0)
	for i := len(pages) - 1; i >= 0; i-- {
		out = append(out, pages[i]...)
	}
	return out, nil
}

func (s *Service) floretProjectionMessageJSON(ctx context.Context, host flruntime.ThreadMaintenanceHost, endpointID string, threadID string, turn threadstore.ConversationTurn, runRecord *threadstore.RunRecord) (json.RawMessage, int64, bool, error) {
	if host == nil {
		return nil, 0, false, nil
	}
	turnID := strings.TrimSpace(turn.TurnID)
	runID := strings.TrimSpace(turn.RunID)
	if turnID == "" || runID == "" {
		return nil, 0, false, nil
	}
	projection, err := host.ReadTurnProjection(ctx, flruntime.ReadTurnProjectionRequest{
		ThreadID: flruntime.ThreadID(strings.TrimSpace(threadID)),
		TurnID:   flruntime.TurnID(turnID),
		RunID:    flruntime.RunID(runID),
	})
	if err != nil {
		if errors.Is(err, flruntime.ErrThreadNotFound) || errors.Is(err, flruntime.ErrTurnNotFound) || errors.Is(err, flruntime.ErrRunNotFound) {
			return nil, 0, false, nil
		}
		return nil, 0, false, err
	}
	createdAt := turn.CreatedAtUnixMs
	if createdAt <= 0 && !projection.Projected.IsZero() {
		createdAt = projection.Projected.UnixMilli()
	}
	if createdAt <= 0 {
		createdAt = time.Now().UnixMilli()
	}
	status := snapshotStatusForFloretProjection(projection, runRecord)
	projectionRun := &run{
		id:                       runID,
		endpointID:               strings.TrimSpace(endpointID),
		threadID:                 strings.TrimSpace(threadID),
		messageID:                turnID,
		service:                  s,
		assistantCreatedAtUnixMs: createdAt,
	}
	blocks := projectionRun.flowerBlocksFromFloretThreadProjection(projection)
	if len(blocks) == 0 {
		return nil, 0, false, nil
	}
	projectionRun.assistantBlocks = blocks
	raw, _, at, err := projectionRun.snapshotAssistantMessageJSONWithStatus(status)
	if err != nil {
		return nil, 0, false, err
	}
	if at > 0 {
		createdAt = at
	}
	sanitized, err := SanitizeActivityTimelineMessageJSON(string(raw))
	if err != nil {
		return nil, 0, false, err
	}
	if len(sanitized) == 0 {
		return nil, 0, false, nil
	}
	return sanitized, createdAt, true, nil
}

func missingTerminalProjectionMessageJSON(turn threadstore.ConversationTurn, runRecord *threadstore.RunRecord) (json.RawMessage, int64, bool, error) {
	if runRecord == nil {
		return nil, 0, false, nil
	}
	turnID := strings.TrimSpace(turn.TurnID)
	if turnID == "" {
		return nil, 0, false, nil
	}
	status := snapshotStatusForRunState(runRecord)
	switch NormalizeRunState(runRecord.State) {
	case RunStateFailed, RunStateCanceled, RunStateTimedOut:
	default:
		return nil, 0, false, nil
	}
	createdAt := turn.CreatedAtUnixMs
	if createdAt <= 0 {
		createdAt = runRecord.EndedAtUnixMs
	}
	if createdAt <= 0 {
		createdAt = runRecord.StartedAtUnixMs
	}
	if createdAt <= 0 {
		createdAt = time.Now().UnixMilli()
	}
	text := terminalProjectionDiagnosticText(runRecord)
	raw, err := json.Marshal(persistedMessage{
		ID:        turnID,
		Role:      "assistant",
		Status:    status,
		Timestamp: createdAt,
		Error:     text,
		Blocks: []any{&persistedMarkdownBlock{
			Type:    "markdown",
			Content: text,
		}},
	})
	if err != nil {
		return nil, 0, false, err
	}
	sanitized, err := SanitizeActivityTimelineMessageJSON(string(raw))
	if err != nil {
		return nil, 0, false, err
	}
	if len(sanitized) == 0 {
		return nil, 0, false, nil
	}
	return sanitized, createdAt, true, nil
}

func terminalProjectionDiagnosticText(runRecord *threadstore.RunRecord) string {
	if runRecord == nil {
		return "Flower could not finish this reply."
	}
	code := strings.TrimSpace(runRecord.ErrorCode)
	fallback := strings.TrimSpace(runRecord.ErrorMessage)
	if code != "" || fallback != "" {
		message := userFacingRunError(code, fallback)
		if strings.TrimSpace(message) != "" {
			return strings.TrimSpace(message)
		}
	}
	switch NormalizeRunState(runRecord.State) {
	case RunStateCanceled:
		return "Flower stopped before this reply finished."
	case RunStateTimedOut:
		return "Flower timed out before this reply finished."
	default:
		return "Flower could not finish this reply."
	}
}

func snapshotStatusForRunState(run *threadstore.RunRecord) string {
	if run == nil {
		return "complete"
	}
	switch NormalizeRunState(run.State) {
	case RunStateCanceled:
		return "canceled"
	case RunStateFailed, RunStateTimedOut:
		return "error"
	case RunStateAccepted, RunStateRunning, RunStateWaitingApproval, RunStateRecovering, RunStateFinalizing, RunStateWaitingUser:
		return "streaming"
	default:
		return "complete"
	}
}

func snapshotStatusForFloretProjection(projection flruntime.ThreadTurnProjection, run *threadstore.RunRecord) string {
	switch projection.Status {
	case flruntime.TurnStatusCancelled:
		return "canceled"
	case flruntime.TurnStatusFailed:
		return "error"
	case flruntime.TurnStatusWaiting:
		return "streaming"
	case flruntime.TurnStatusCompleted:
		return "complete"
	default:
		return snapshotStatusForRunState(run)
	}
}

func runStateCanLackFloretProjection(state string) bool {
	switch NormalizeRunState(state) {
	case RunStateAccepted, RunStateRunning, RunStateWaitingApproval, RunStateRecovering, RunStateFinalizing:
		return true
	default:
		return false
	}
}

func timelineSourceRank(role string) int {
	switch strings.TrimSpace(role) {
	case "user":
		return 0
	case "assistant":
		return 1
	default:
		return 2
	}
}
