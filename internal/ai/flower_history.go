package ai

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/threadquery"
	fltools "github.com/floegence/floret/v7/tools"
	"github.com/floegence/redeven/internal/session"
)

// Opening a conversation needs one viewport, not the retained-history capacity.
// Explicit pagination and protected selections retain their requested bounds.
const flowerInitialHistoryItems = 50

func flowerHistoryWindowInput(threadID identity.ThreadID, input FlowerHistoryRequest) flruntime.ThreadWindowInput {
	limit := input.Limit
	if limit == 0 && input.ItemIDs == nil {
		limit = flowerInitialHistoryItems
	}
	return flruntime.ThreadWindowInput{ThreadID: threadID, AnchorID: input.AnchorID, AnchorOffset: input.AnchorOffset, Direction: input.Direction, Limit: limit, ItemIDs: input.ItemIDs, IncludeSummary: true, ActivityFields: true, PreviewBytes: 1024}
}

// FlowerHistoryWindow is disposable reading state, never a journal cursor.
type FlowerHistoryWindow struct {
	LeafID      string                   `json:"leaf_id,omitempty"`
	Summary     *flruntime.ThreadSummary `json:"-"`
	FirstItemID string                   `json:"first_item_id,omitempty"`
	LastItemID  string                   `json:"last_item_id,omitempty"`
	HasBefore   bool                     `json:"has_before"`
	HasAfter    bool                     `json:"has_after"`
}

type FlowerHistoryRequest struct {
	AnchorOffset    int                             `json:"anchor_offset,omitempty"`
	ItemIDs         []string                        `json:"item_ids,omitempty"`
	ParentThreadID  string                          `json:"-"`
	ObserverID      string                          `json:"observer_id,omitempty"`
	ReadingRevision uint64                          `json:"reading_revision,omitempty"`
	AnchorID        string                          `json:"anchor_id,omitempty"`
	Direction       flruntime.ThreadWindowDirection `json:"direction,omitempty"`
	Limit           int                             `json:"limit,omitempty"`
}

// FlowerHistoryBodyRequest resumes one presentation source at an accepted UTF-8 offset.
// The server resolves the source again; client locators never grant access.
type FlowerHistoryBodyRequest struct {
	ItemID       string                    `json:"item_id"`
	RunID        identity.RunID            `json:"run_id,omitempty"`
	SourceID     string                    `json:"source_id,omitempty"`
	EntryID      string                    `json:"entry_id,omitempty"`
	Field        flruntime.ThreadBodyField `json:"field"`
	ThroughBytes int                       `json:"through_bytes"`
	OffsetBytes  int                       `json:"offset_bytes"`
}

// FlowerHistoryBodyChunk keeps source retirement explicit. A sealed source is
// read only after the canonical observation supplies its new identity/offset.
type FlowerHistoryBodyChunk struct {
	flruntime.ThreadItemTextChunk
	SourceChanged bool `json:"source_changed,omitempty"`
}

func (s *Service) GetFlowerHistoryBody(ctx context.Context, meta *session.Meta, threadID string, input FlowerHistoryBodyRequest) (FlowerHistoryBodyChunk, error) {
	var empty FlowerHistoryBodyChunk
	scope, err := s.flowerHistoryScope(ctx, meta, threadID)
	if err != nil {
		return empty, err
	}
	if input.ItemID == "" || input.OffsetBytes < 0 || input.ThroughBytes < input.OffsetBytes {
		return empty, threadquery.ErrInvalidQuery
	}
	reader, ok := s.threadRuntime.(flruntime.ThreadItemTextReader)
	if !ok {
		return empty, errors.New("published Floret item text contract is unavailable")
	}
	chunk, err := reader.ReadItemText(ctx, scope, flruntime.ThreadItemTextInput{ThreadID: identity.ThreadID(threadID), ItemID: input.ItemID, RunID: input.RunID, SourceID: input.SourceID, EntryID: input.EntryID, Field: input.Field, ThroughBytes: input.ThroughBytes, OffsetBytes: input.OffsetBytes, LimitBytes: 16 << 10})
	if errors.Is(err, threadquery.ErrRecordUnavailable) && input.RunID != "" && input.SourceID == input.ItemID && input.EntryID == "" {
		// Floret owns the transition and rejects the retired live locator. Only
		// its authorized current locator can confirm this expected handoff;
		// unavailable or unchanged sources retain their original error.
		if locator, ok := s.threadRuntime.(flruntime.ThreadItemBodyReader); ok {
			body, locateErr := locator.ItemBody(ctx, scope, flruntime.ThreadItemBodyInput{ThreadID: identity.ThreadID(threadID), ItemID: input.ItemID})
			if locateErr == nil && body.RunID == "" && body.SourceID == input.ItemID && body.EntryID == "" && body.Field == input.Field {
				return FlowerHistoryBodyChunk{ThreadItemTextChunk: flruntime.ThreadItemTextChunk{ThreadID: identity.ThreadID(threadID), ItemID: input.ItemID}, SourceChanged: true}, nil
			}
		}
	}
	return FlowerHistoryBodyChunk{ThreadItemTextChunk: chunk}, err
}

func (s *Service) flowerHistoryScope(ctx context.Context, meta *session.Meta, threadID string) (threadquery.Scope, error) {
	settings, err := s.threadSettingsForRead(ctx, meta, threadID)
	if err != nil {
		return threadquery.Scope{}, err
	}
	if settings == nil {
		return threadquery.Scope{}, flruntime.ErrThreadNotFound
	}
	if strings.TrimSpace(meta.UserPublicID) == "" {
		return threadquery.Scope{}, errReadPermissionDenied
	}
	authority, err := json.Marshal([]string{meta.UserPublicID, meta.EndpointID, meta.NamespacePublicID})
	if err != nil {
		return threadquery.Scope{}, err
	}
	return threadquery.Scope{Authority: string(authority), ThreadIDs: []identity.ThreadID{identity.ThreadID(threadID)}}, nil
}

// Read the baseline from the subscription on which SetWindow publishes it.
// There is deliberately no View-and-slice fallback.
func readFlowerHistory(ctx context.Context, runtime flruntime.ThreadService, scope threadquery.Scope, input flruntime.ThreadWindowInput) (flruntime.ThreadView, *FlowerHistoryWindow, error) {
	source, ok := runtime.(flruntime.ThreadWindowSource)
	if !ok {
		return flruntime.ThreadView{}, nil, errors.New("published Floret window contract is unavailable")
	}
	sub, err := source.SubscribeWindowUpdates(ctx, scope)
	if err != nil {
		return flruntime.ThreadView{}, nil, err
	}
	defer sub.Close()
	if err := sub.SetWindow(ctx, scope, input); err != nil {
		return flruntime.ThreadView{}, nil, err
	}
	for {
		update, err := sub.Next(ctx)
		if err != nil {
			return flruntime.ThreadView{}, nil, err
		}
		if update.Window != nil && update.Window.Value != nil {
			current, window := flowerHistoryCurrent(update)
			return current, window, nil
		}
	}
}

func flowerHistoryCurrent(update flruntime.ThreadUpdate) (flruntime.ThreadView, *FlowerHistoryWindow) {
	w := update.Window.Value
	current := flruntime.ThreadView{ThreadID: update.ThreadID, ViewVersion: update.ViewVersion, TurnID: update.TurnID, RunID: update.RunID,
		Activity: update.Facts.Activity, Attention: update.Facts.Attention, TurnKind: update.Facts.TurnKind,
		LastOutcome: update.Facts.LastOutcome, Failure: update.Facts.Failure, Cancellation: update.Facts.Cancellation, RunProgress: update.Facts.RunProgress, Items: w.Items}
	if update.Context != nil {
		current.Context = flowerWindowContext(update.Context.Value, w.Items, current.RunID)
	}
	if update.Goal != nil {
		current.Goal = update.Goal.Value
	}
	if update.ParentEvents != nil {
		current.ParentEvents = update.ParentEvents.Value
	}
	if update.Turns != nil {
		current.Turns = update.Turns.Value
	}
	if update.Queue != nil {
		current.Queue = update.Queue.Value
	}
	if update.Interactions != nil {
		current.Interactions = update.Interactions.Value
	}
	if update.ToolCallPreviews != nil {
		current.ToolCallPreviews = update.ToolCallPreviews.Value
	}
	if update.RestoredInputs != nil {
		current.RestoredInputs = update.RestoredInputs.Value
	}
	return current, &FlowerHistoryWindow{LeafID: w.LeafID, Summary: w.Summary, FirstItemID: w.FirstItemID, LastItemID: w.LastItemID, HasBefore: w.HasBefore, HasAfter: w.HasAfter}
}

func (s *Service) GetFlowerThreadHistory(ctx context.Context, meta *session.Meta, threadID string, input FlowerHistoryRequest) (*FlowerThreadDetail, error) {
	scope, err := s.flowerHistoryScope(ctx, meta, threadID)
	if err != nil {
		return nil, err
	}
	settings, err := s.threadSettingsForRead(ctx, meta, threadID)
	if err != nil {
		return nil, err
	}
	// Metadata and the read watermark come from the same explicit baseline.
	// No separate preparation window or independently sampled Summary is needed.
	current, window, err := s.readFlowerHistoryForObserver(ctx, meta, scope, input, flowerHistoryWindowInput(identity.ThreadID(threadID), input))
	if err != nil {
		return nil, err
	}
	if window == nil || window.Summary == nil || window.Summary.ID != current.ThreadID {
		return nil, errors.New("canonical history baseline has no matching summary")
	}
	current.Items, err = s.hydrateActivityTargets(ctx, meta, threadID, current.Items)
	if err != nil {
		return nil, err
	}
	evidence, err := s.flowerHistoryComputerEvidence(ctx, scope, current.ThreadID, current.Interactions)
	if err != nil {
		return nil, err
	}
	thread, err := s.threadViewFromRecord(ctx, settings, current, window.Summary)
	if err != nil {
		return nil, err
	}
	projection, err := flowerCurrentContextProjection(current)
	if err != nil {
		return nil, err
	}
	thread.ModelContext, thread.ContextUsage, thread.ContextCompactions, thread.TimelineDecorations = projection.ModelContext, projection.Usage, projection.Compactions, projection.Decorations
	return &FlowerThreadDetail{Thread: thread, Current: current, Window: window, ComputerEvidence: evidence}, nil
}

// GetFlowerHistoryItem expands exactly one authorized item. Body locators come
// from the canonical window, never from client-provided entry identifiers.
func (s *Service) GetFlowerHistoryItem(ctx context.Context, meta *session.Meta, threadID, itemID string) (json.RawMessage, error) {
	scope, err := s.flowerHistoryScope(ctx, meta, threadID)
	if err != nil {
		return nil, err
	}
	current, _, err := readFlowerHistory(ctx, s.threadRuntime, scope, flruntime.ThreadWindowInput{ThreadID: identity.ThreadID(threadID), AnchorID: itemID, Direction: flruntime.ThreadWindowAround, Limit: 1})
	if err != nil {
		return nil, err
	}
	if len(current.Items) != 1 || current.Items[0].ID != itemID {
		return nil, flruntime.ErrThreadNotFound
	}
	item := current.Items[0]
	reader, ok := s.threadRuntime.(flruntime.ThreadBodyReader)
	if !ok {
		return nil, errors.New("published Floret body contract is unavailable")
	}
	readPart := func(entry string, field flruntime.ThreadBodyField, expected int, hash string) (string, error) {
		var text strings.Builder
		for text.Len() < expected {
			scope, err := s.flowerHistoryScope(ctx, meta, threadID)
			if err != nil {
				return "", err
			}
			chunk, err := reader.ReadBody(ctx, scope, flruntime.ThreadBodyInput{ThreadID: identity.ThreadID(threadID), EntryID: entry, Field: field, OffsetBytes: text.Len(), SHA256: hash})
			if err != nil {
				return "", err
			}
			if chunk.Bytes != expected || chunk.OffsetBytes != text.Len() || chunk.Text == "" {
				return "", errors.New("body extent changed")
			}
			if hash == "" {
				hash = chunk.SHA256
			}
			text.WriteString(chunk.Text)
		}
		if expected == 0 {
			return "", nil
		}
		if text.Len() != expected || fmt.Sprintf("%x", sha256.Sum256([]byte(text.String()))) != hash {
			return "", errors.New("body integrity mismatch")
		}
		return text.String(), nil
	}
	if body := item.Body; body != nil {
		var text strings.Builder
		controlOutput := body.Field == flruntime.ThreadBodyControlOutput
		switch {
		case body.RunID != "":
			live, ok := s.threadRuntime.(flruntime.ThreadLiveBodyReader)
			if !ok {
				return nil, errors.New("published Floret live body contract is unavailable")
			}
			for text.Len() < body.Bytes {
				scope, err := s.flowerHistoryScope(ctx, meta, threadID)
				if err != nil {
					return nil, err
				}
				chunk, err := live.ReadLiveBody(ctx, scope, flruntime.ThreadLiveBodyInput{ThreadID: current.ThreadID, RunID: body.RunID, SourceID: body.SourceID, ThroughBytes: body.Bytes, OffsetBytes: text.Len()})
				if err != nil {
					return nil, err
				}
				if chunk.Text == "" || chunk.OffsetBytes != text.Len() {
					return nil, errors.New("live body extent changed")
				}
				text.WriteString(chunk.Text)
			}
		case body.SourceID != "":
			manifests, ok := s.threadRuntime.(flruntime.ThreadBodyManifestReader)
			if !ok {
				return nil, errors.New("published Floret body manifest contract is unavailable")
			}
			input := flruntime.ThreadBodyManifestInput{ThreadID: current.ThreadID, SourceID: body.SourceID, Field: body.Field}
			for {
				scope, err := s.flowerHistoryScope(ctx, meta, threadID)
				if err != nil {
					return nil, err
				}
				page, err := manifests.BodyManifest(ctx, scope, input)
				if err != nil {
					return nil, err
				}
				for _, part := range page.Parts {
					controlOutput = controlOutput || part.Field == flruntime.ThreadBodyControlOutput
					value, err := readPart(part.EntryID, part.Field, part.Bytes, part.SHA256)
					if err != nil {
						return nil, err
					}
					text.WriteString(value)
				}
				if !page.HasMore {
					break
				}
				if page.NextEntryID == "" || page.NextEntryID == input.AfterEntryID {
					return nil, errors.New("body manifest did not advance")
				}
				input.LeafID, input.AfterEntryID = page.LeafID, page.NextEntryID
			}
		default:
			value, err := readPart(body.EntryID, body.Field, body.Bytes, "")
			if err != nil {
				return nil, err
			}
			text.WriteString(value)
		}
		item.Text, item.Body = text.String(), nil
		if controlOutput {
			item.Text = strings.TrimSpace(item.Text)
			if item.Text == "" {
				item.Text = current.Items[0].Text
			}
		}
	}
	if len(item.ActivityBodies) > 0 {
		if item.Activity == nil {
			return nil, errors.New("activity body has no activity")
		}
		var presentation *fltools.ActivityPresentation
		for _, body := range item.ActivityBodies {
			// Empty sources carry the canonical owner's default. Merge every
			// source in order without loading unrelated conversation history.
			next := body.DefaultPresentation
			if body.Bytes != 0 {
				value, err := readPart(body.EntryID, flruntime.ThreadBodyActivityJSON, body.Bytes, body.SHA256)
				if err != nil {
					return nil, err
				}
				if err := json.Unmarshal([]byte(value), &next); err != nil {
					return nil, err
				}
			}
			if next == nil {
				return nil, errors.New("activity source has no canonical presentation")
			}
			if err := next.Validate(); err != nil {
				return nil, err
			}
			presentation = fltools.MergeActivityPresentations(presentation, next)
		}
		activity := *item.Activity
		activity.Presentation = presentation
		item.Activity, item.ActivityBodies = &activity, nil
	}
	hydrated, err := s.hydrateActivityTargets(ctx, meta, threadID, []flruntime.ThreadItem{item})
	if err != nil {
		return nil, err
	}
	return json.Marshal(projectFlowerItem(hydrated[0], threadID, &current))
}

// Safety provenance may refer to a tool outside the displayed interval. Read
// canonical evidence on the server only when a pending input cites it; never
// serialize those historical items as part of a bounded page.
// Evidence needs ordered safety facts from the pending turns, never transcript
// bodies. Scan bounded canonical pages, stop at each turn's user boundary, and
// reject a moving path rather than combine independently sampled histories.
func (s *Service) flowerHistoryComputerEvidence(ctx context.Context, scope threadquery.Scope, id identity.ThreadID, interactions []flruntime.ThreadInteraction) (*flruntime.ThreadView, error) {
	return readFlowerComputerEvidence(ctx, id, interactions,
		func(ctx context.Context, input flruntime.ThreadWindowInput) (flruntime.ThreadView, *FlowerHistoryWindow, error) {
			return readFlowerHistory(ctx, s.threadRuntime, scope, input)
		}, func(ctx context.Context, item flruntime.ThreadItem) (flruntime.ThreadItem, error) {
			return s.flowerComputerEvidenceItem(ctx, scope, id, item)
		})
}

func readFlowerComputerEvidence(ctx context.Context, id identity.ThreadID, interactions []flruntime.ThreadInteraction,
	read func(context.Context, flruntime.ThreadWindowInput) (flruntime.ThreadView, *FlowerHistoryWindow, error),
	resolve func(context.Context, flruntime.ThreadItem) (flruntime.ThreadItem, error)) (*flruntime.ThreadView, error) {
	pending := make(map[identity.TurnID]bool)
	for _, interaction := range interactions {
		if interaction.Kind == flruntime.ThreadInteractionInput && !interaction.Resolved && interaction.Input != nil && (len(interaction.Input.EvidenceRefs) > 0 || strings.HasPrefix(interaction.ID, "tool-input:")) {
			pending[interaction.TurnID] = true
		}
	}
	if len(pending) == 0 {
		return nil, nil
	}
	view := &flruntime.ThreadView{ThreadID: id}
	input := flruntime.ThreadWindowInput{ThreadID: id, Limit: 64, ActivityFields: true, PreviewBytes: 128, Direction: flruntime.ThreadWindowBefore}
	var leaf string
	var version uint64
	for {
		page, window, err := read(ctx, input)
		if err != nil {
			return nil, err
		}
		if window == nil || input.AnchorID != "" && (window.LeafID != leaf || page.ViewVersion != version) {
			return nil, threadquery.ErrRecordUnavailable
		}
		leaf, version = window.LeafID, page.ViewVersion
		view.ViewVersion = version
		for index := len(page.Items) - 1; index >= 0; index-- {
			item := page.Items[index]
			if !pending[item.TurnID] {
				continue
			}
			if item.Kind == flruntime.ThreadItemUser {
				delete(pending, item.TurnID)
				continue
			}
			if item.Activity == nil || !isComputerUseTool(item.Activity.ToolName) {
				continue
			}
			item, err = resolve(ctx, item)
			if err != nil {
				return nil, err
			}
			view.Items = append(view.Items, item)
		}
		if len(pending) == 0 || !window.HasBefore {
			break
		}
		if window.FirstItemID == "" || window.FirstItemID == input.AnchorID {
			return nil, threadquery.ErrRecordUnavailable
		}
		input.AnchorID = window.FirstItemID
	}
	// Field reads may span source transactions. Confirm the monotonic version
	// and leaf before accepting safety facts sampled across those reads.
	confirmed, confirmedWindow, err := read(ctx, flruntime.ThreadWindowInput{ThreadID: id, Limit: 1, ActivityFields: true, PreviewBytes: 128})
	if err != nil {
		return nil, err
	}
	if confirmedWindow == nil || confirmedWindow.LeafID != leaf || confirmed.ViewVersion != version {
		return nil, threadquery.ErrRecordUnavailable
	}
	for left, right := 0, len(view.Items)-1; left < right; left, right = left+1, right-1 {
		view.Items[left], view.Items[right] = view.Items[right], view.Items[left]
	}
	return view, nil
}

func (s *Service) flowerComputerEvidenceItem(ctx context.Context, scope threadquery.Scope, id identity.ThreadID, item flruntime.ThreadItem) (flruntime.ThreadItem, error) {
	if item.ActivitySummary == nil {
		return item, nil
	}
	presentation := &fltools.ActivityPresentation{}
	for _, field := range []struct {
		path   string
		target any
	}{{"/chips", &presentation.Chips}, {"/target_refs", &presentation.TargetRefs}} {
		raw := item.ActivitySummary.Values[field.path]
		if len(raw) == 0 {
			for _, source := range item.ActivitySummary.Fields {
				if source.Path != field.path || source.Kind != "array" || source.Count == 0 {
					continue
				}
				// Unusually large safety collections are still explicit field
				// reads. Never treat omitted summary metadata as canonical absence.
				reader, ok := s.threadRuntime.(flruntime.ThreadActivityValueReader)
				if !ok {
					return item, errors.New("published Floret activity value contract is unavailable")
				}
				values := make([]json.RawMessage, 0, source.Count)
				for index := 0; index < source.Count; index++ {
					value, err := reader.ReadActivityValue(ctx, scope, flruntime.ThreadActivityValueInput{ThreadID: id, ItemID: item.ID, Path: fmt.Sprintf("%s/%d", field.path, index), MaximumBytes: 64 << 10, MaximumNodes: 16})
					if err != nil {
						return item, err
					}
					if value.ThreadID != id || value.ItemID != item.ID || value.TurnID != item.TurnID || value.RunID != item.RunID {
						return item, threadquery.ErrRecordUnavailable
					}
					values = append(values, value.Value)
				}
				var err error
				raw, err = json.Marshal(values)
				if err != nil {
					return item, err
				}
			}
		}
		if len(raw) > 0 {
			if err := json.Unmarshal(raw, field.target); err != nil {
				return item, err
			}
		}
	}
	activity := *item.Activity
	activity.Presentation = presentation
	item.Activity = &activity
	item.Text, item.Body, item.ActivityBodies, item.ActivitySummary = "", nil, nil, nil
	return item, nil
}

// MarshalFlowerHistoryCurrent keeps command receipts on the same bounded
// presentation boundary as navigation. Admission identities remain in the receipt.
func (s *Service) MarshalFlowerHistoryCurrent(ctx context.Context, meta *session.Meta, threadID string) (json.RawMessage, error) {
	detail, err := s.GetFlowerThreadHistory(ctx, meta, threadID, FlowerHistoryRequest{})
	if err != nil {
		return nil, err
	}
	public, err := projectFlowerCurrent(detail.Current, time.Now(), detail.ComputerEvidence)
	if err != nil {
		return nil, err
	}
	return json.Marshal(struct {
		flowerPublicCurrent
		Window *FlowerHistoryWindow `json:"window"`
	}{public, detail.Window})
}
