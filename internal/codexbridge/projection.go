package codexbridge

import "strings"

type projectedItemLifecyclePhase string

const (
	projectedItemLifecycleStarted   projectedItemLifecyclePhase = "started"
	projectedItemLifecycleCompleted projectedItemLifecyclePhase = "completed"
)

func cloneThread(thread Thread) Thread {
	cloned := thread
	cloned.ActiveFlags = cloneStringList(thread.ActiveFlags)
	cloned.Turns = cloneTurns(thread.Turns)
	return cloned
}

func cloneTurns(turns []Turn) []Turn {
	if len(turns) == 0 {
		return nil
	}
	out := make([]Turn, 0, len(turns))
	for _, turn := range turns {
		out = append(out, cloneTurn(turn))
	}
	return out
}

func cloneTurn(turn Turn) Turn {
	cloned := turn
	if turn.Error != nil {
		errCopy := *turn.Error
		cloned.Error = &errCopy
	}
	if turn.AcceptsSteer != nil {
		acceptsSteer := *turn.AcceptsSteer
		cloned.AcceptsSteer = &acceptsSteer
	}
	cloned.Items = cloneItems(turn.Items)
	return cloned
}

func cloneItems(items []Item) []Item {
	if len(items) == 0 {
		return nil
	}
	out := make([]Item, 0, len(items))
	for _, item := range items {
		out = append(out, cloneItem(item))
	}
	return out
}

func cloneItem(item Item) Item {
	cloned := item
	cloned.Summary = cloneStringList(item.Summary)
	cloned.Content = cloneStringList(item.Content)
	cloned.Changes = cloneFileChanges(item.Changes)
	cloned.Inputs = cloneUserInputs(item.Inputs)
	cloned.Action = cloneWebSearchAction(item.Action)
	if item.ExitCode != nil {
		exitCode := *item.ExitCode
		cloned.ExitCode = &exitCode
	}
	if item.DurationMs != nil {
		duration := *item.DurationMs
		cloned.DurationMs = &duration
	}
	return cloned
}

func cloneFileChanges(changes []FileChange) []FileChange {
	if len(changes) == 0 {
		return nil
	}
	out := make([]FileChange, 0, len(changes))
	out = append(out, changes...)
	return out
}

func cloneUserInputs(inputs []UserInputEntry) []UserInputEntry {
	if len(inputs) == 0 {
		return nil
	}
	out := make([]UserInputEntry, 0, len(inputs))
	for _, input := range inputs {
		cloned := input
		cloned.TextElements = cloneTextElements(input.TextElements)
		out = append(out, cloned)
	}
	return out
}

func cloneTextElements(elements []TextElement) []TextElement {
	if len(elements) == 0 {
		return nil
	}
	out := make([]TextElement, 0, len(elements))
	out = append(out, elements...)
	return out
}

func cloneWebSearchAction(action *WebSearchAction) *WebSearchAction {
	if action == nil {
		return nil
	}
	cloned := *action
	cloned.Queries = cloneStringList(action.Queries)
	return &cloned
}

func cloneStringList(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	out := make([]string, 0, len(values))
	out = append(out, values...)
	return out
}

func cloneThreadTokenUsage(usage *ThreadTokenUsage) *ThreadTokenUsage {
	if usage == nil {
		return nil
	}
	cloned := *usage
	cloned.Total = usage.Total
	cloned.Last = usage.Last
	if usage.ModelContextWindow != nil {
		window := *usage.ModelContextWindow
		cloned.ModelContextWindow = &window
	}
	return &cloned
}

func normalizeProjectedItemStatus(raw string, phase projectedItemLifecyclePhase) string {
	if normalized := strings.TrimSpace(raw); normalized != "" {
		return normalized
	}
	switch phase {
	case projectedItemLifecycleStarted:
		return "inProgress"
	case projectedItemLifecycleCompleted:
		return "completed"
	default:
		return ""
	}
}

func normalizeProjectedItemForLifecycle(item Item, phase projectedItemLifecyclePhase) Item {
	item.Status = normalizeProjectedItemStatus(item.Status, phase)
	return item
}

func markProjectedItemLifecycle(item *Item, phase projectedItemLifecyclePhase) {
	if item == nil {
		return
	}
	item.Status = normalizeProjectedItemStatus(item.Status, phase)
}

func mergeProjectedThread(state *threadState, snapshot Thread) Thread {
	merged := cloneThread(snapshot)
	if state == nil || state.thread == nil {
		return merged
	}
	existing := state.thread
	if strings.TrimSpace(merged.Preview) == "" {
		merged.Preview = existing.Preview
	}
	if strings.TrimSpace(merged.Path) == "" {
		merged.Path = existing.Path
	}
	if strings.TrimSpace(merged.CLIVersion) == "" {
		merged.CLIVersion = existing.CLIVersion
	}
	if strings.TrimSpace(merged.Source) == "" {
		merged.Source = existing.Source
	}
	if strings.TrimSpace(merged.AgentNickname) == "" {
		merged.AgentNickname = existing.AgentNickname
	}
	if strings.TrimSpace(merged.AgentRole) == "" {
		merged.AgentRole = existing.AgentRole
	}
	if strings.TrimSpace(merged.Name) == "" {
		merged.Name = existing.Name
	}
	if strings.TrimSpace(merged.CWD) == "" {
		merged.CWD = existing.CWD
	}
	if existing.UpdatedAtUnixS > merged.UpdatedAtUnixS {
		merged.UpdatedAtUnixS = existing.UpdatedAtUnixS
	}
	if len(existing.Turns) > 0 {
		merged.Turns = cloneTurns(existing.Turns)
	}
	if state.liveLoaded || isLoadedThreadStatus(existing.Status) {
		if strings.TrimSpace(existing.Status) != "" {
			merged.Status = existing.Status
		}
		merged.ActiveFlags = cloneStringList(existing.ActiveFlags)
	}
	return merged
}

func isLoadedThreadStatus(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "", "notloaded", "not_loaded", "archived":
		return false
	default:
		return true
	}
}

func ensureProjectedThread(state *threadState, threadID string) *Thread {
	if state.thread == nil {
		state.thread = &Thread{ID: strings.TrimSpace(threadID)}
	}
	if strings.TrimSpace(state.thread.ID) == "" {
		state.thread.ID = strings.TrimSpace(threadID)
	}
	return state.thread
}

func upsertProjectedTurn(thread *Thread, turn Turn) *Turn {
	if thread == nil {
		return nil
	}
	normalizedTurnID := strings.TrimSpace(turn.ID)
	if normalizedTurnID == "" {
		return nil
	}
	for index := range thread.Turns {
		if strings.TrimSpace(thread.Turns[index].ID) != normalizedTurnID {
			continue
		}
		existing := &thread.Turns[index]
		if strings.TrimSpace(turn.Status) != "" {
			existing.Status = strings.TrimSpace(turn.Status)
		}
		if strings.TrimSpace(turn.Kind) != "" {
			existing.Kind = strings.TrimSpace(turn.Kind)
		}
		if turn.AcceptsSteer != nil {
			acceptsSteer := *turn.AcceptsSteer
			existing.AcceptsSteer = &acceptsSteer
		}
		if turn.Error != nil {
			errCopy := *turn.Error
			existing.Error = &errCopy
		}
		for _, item := range turn.Items {
			upsertProjectedItem(existing, item)
		}
		return existing
	}
	thread.Turns = append(thread.Turns, cloneTurn(turn))
	return &thread.Turns[len(thread.Turns)-1]
}

func ensureProjectedTurn(thread *Thread, turnID string) *Turn {
	if thread == nil {
		return nil
	}
	normalizedTurnID := strings.TrimSpace(turnID)
	if normalizedTurnID == "" {
		return nil
	}
	for index := range thread.Turns {
		if strings.TrimSpace(thread.Turns[index].ID) == normalizedTurnID {
			return &thread.Turns[index]
		}
	}
	thread.Turns = append(thread.Turns, Turn{ID: normalizedTurnID, Status: "in_progress"})
	return &thread.Turns[len(thread.Turns)-1]
}

func upsertProjectedItem(turn *Turn, item Item) *Item {
	if turn == nil {
		return nil
	}
	normalizedItemID := strings.TrimSpace(item.ID)
	if normalizedItemID == "" {
		return nil
	}
	for index := range turn.Items {
		if strings.TrimSpace(turn.Items[index].ID) != normalizedItemID {
			continue
		}
		existing := &turn.Items[index]
		if strings.TrimSpace(item.Type) != "" {
			existing.Type = strings.TrimSpace(item.Type)
		}
		if strings.TrimSpace(item.Text) != "" {
			existing.Text = item.Text
		}
		if strings.TrimSpace(item.Phase) != "" {
			existing.Phase = item.Phase
		}
		if len(item.Summary) > 0 {
			existing.Summary = cloneStringList(item.Summary)
		}
		if len(item.Content) > 0 {
			existing.Content = cloneStringList(item.Content)
		}
		if strings.TrimSpace(item.Command) != "" {
			existing.Command = item.Command
		}
		if strings.TrimSpace(item.CWD) != "" {
			existing.CWD = item.CWD
		}
		if strings.TrimSpace(item.Status) != "" {
			existing.Status = item.Status
		}
		if strings.TrimSpace(item.AggregatedOutput) != "" {
			existing.AggregatedOutput = item.AggregatedOutput
		}
		if item.ExitCode != nil {
			exitCode := *item.ExitCode
			existing.ExitCode = &exitCode
		}
		if item.DurationMs != nil {
			duration := *item.DurationMs
			existing.DurationMs = &duration
		}
		if len(item.Changes) > 0 {
			existing.Changes = cloneFileChanges(item.Changes)
		}
		if strings.TrimSpace(item.Query) != "" {
			existing.Query = item.Query
		}
		if len(item.Inputs) > 0 {
			existing.Inputs = cloneUserInputs(item.Inputs)
		}
		return existing
	}
	turn.Items = append(turn.Items, cloneItem(item))
	return &turn.Items[len(turn.Items)-1]
}

func ensureProjectedItem(turn *Turn, itemID string, itemType string) *Item {
	if turn == nil {
		return nil
	}
	normalizedItemID := strings.TrimSpace(itemID)
	if normalizedItemID == "" {
		return nil
	}
	for index := range turn.Items {
		if strings.TrimSpace(turn.Items[index].ID) == normalizedItemID {
			if strings.TrimSpace(turn.Items[index].Type) == "" && strings.TrimSpace(itemType) != "" {
				turn.Items[index].Type = strings.TrimSpace(itemType)
			}
			markProjectedItemLifecycle(&turn.Items[index], projectedItemLifecycleStarted)
			return &turn.Items[index]
		}
	}
	turn.Items = append(turn.Items, Item{
		ID:     normalizedItemID,
		Type:   strings.TrimSpace(itemType),
		Status: normalizeProjectedItemStatus("", projectedItemLifecycleStarted),
	})
	return &turn.Items[len(turn.Items)-1]
}

func ensureStringPart(values []string, index int64) []string {
	if index < 0 {
		return values
	}
	for int64(len(values)) <= index {
		values = append(values, "")
	}
	return values
}

func appendProjectedItemText(item *Item, delta string) {
	if item == nil || delta == "" {
		return
	}
	item.Text += delta
}

func appendProjectedItemSummary(item *Item, summaryIndex int64, delta string) {
	if item == nil {
		return
	}
	item.Summary = ensureStringPart(item.Summary, summaryIndex)
	if delta != "" {
		item.Summary[summaryIndex] += delta
	}
}

func appendProjectedItemContent(item *Item, contentIndex int64, delta string) {
	if item == nil {
		return
	}
	item.Content = ensureStringPart(item.Content, contentIndex)
	if delta != "" {
		item.Content[contentIndex] += delta
	}
	item.Text = strings.Join(item.Content, "\n\n")
}

func appendProjectedFileChange(item *Item, delta string) {
	if item == nil || delta == "" {
		return
	}
	if len(item.Changes) == 0 {
		item.Changes = []FileChange{{
			Path: "Pending diff",
			Kind: "stream",
			Diff: delta,
		}}
		return
	}
	lastIndex := len(item.Changes) - 1
	item.Changes[lastIndex].Diff += delta
}
