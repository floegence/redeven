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

// FlowerHistoryWindow is disposable reading state, never a journal cursor.
type FlowerHistoryWindow struct {
	FirstItemID string `json:"first_item_id,omitempty"`
	LastItemID  string `json:"last_item_id,omitempty"`
	HasBefore   bool   `json:"has_before"`
	HasAfter    bool   `json:"has_after"`
}

type FlowerHistoryRequest struct {
	ParentThreadID  string                          `json:"-"`
	ObserverID      string                          `json:"observer_id,omitempty"`
	ReadingRevision uint64                          `json:"reading_revision,omitempty"`
	AnchorID        string                          `json:"anchor_id,omitempty"`
	Direction       flruntime.ThreadWindowDirection `json:"direction,omitempty"`
	Limit           int                             `json:"limit,omitempty"`
}

// FlowerHistoryBodyRequest resumes one live source at an accepted UTF-8 offset.
// The server resolves the source again; client locators never grant access.
type FlowerHistoryBodyRequest struct {
	ItemID       string         `json:"item_id"`
	RunID        identity.RunID `json:"run_id"`
	SourceID     string         `json:"source_id"`
	ThroughBytes int            `json:"through_bytes"`
	OffsetBytes  int            `json:"offset_bytes"`
}

func (s *Service) GetFlowerHistoryBody(ctx context.Context, meta *session.Meta, threadID string, input FlowerHistoryBodyRequest) (flruntime.ThreadLiveBodyChunk, error) {
	var empty flruntime.ThreadLiveBodyChunk
	scope, err := s.flowerHistoryScope(ctx, meta, threadID)
	if err != nil {
		return empty, err
	}
	if input.ItemID == "" || input.RunID == "" || input.SourceID == "" || input.OffsetBytes < 0 || input.ThroughBytes <= input.OffsetBytes {
		return empty, threadquery.ErrInvalidQuery
	}
	locator, ok := s.threadRuntime.(flruntime.ThreadItemBodyReader)
	if !ok {
		return empty, errors.New("published Floret item body contract is unavailable")
	}
	reader, ok := s.threadRuntime.(flruntime.ThreadLiveBodyReader)
	if !ok {
		return empty, errors.New("published Floret live body contract is unavailable")
	}
	body, err := locator.ItemBody(ctx, scope, flruntime.ThreadItemBodyInput{ThreadID: identity.ThreadID(threadID), ItemID: input.ItemID})
	if err != nil {
		return empty, err
	}
	if body.RunID != input.RunID || body.SourceID != input.SourceID || input.ThroughBytes > body.Bytes {
		return empty, threadquery.ErrRecordUnavailable
	}
	// One request reads at most 16 KiB, with no window subscription, full View,
	// prefix re-download, or host-owned durable body cache.
	return reader.ReadLiveBody(ctx, scope, flruntime.ThreadLiveBodyInput{ThreadID: identity.ThreadID(threadID), RunID: body.RunID, SourceID: body.SourceID, ThroughBytes: input.ThroughBytes, OffsetBytes: input.OffsetBytes, LimitBytes: 16 << 10})
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
		current.Context = update.Context.Value
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
	return current, &FlowerHistoryWindow{w.FirstItemID, w.LastItemID, w.HasBefore, w.HasAfter}
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
	runtime, err := s.typedFloretRuntime()
	if err != nil {
		return nil, err
	}
	// Prepare the canonical actor before Summary. Read the accepted window after
	// Summary so the read watermark cannot claim unseen content. This bounded
	// preparation never materializes a complete View.
	if _, _, err := readFlowerHistory(ctx, runtime, scope, flruntime.ThreadWindowInput{ThreadID: identity.ThreadID(threadID), Limit: 1}); err != nil {
		return nil, err
	}
	summary, err := threadSummaryFromRuntime(ctx, runtime, identity.ThreadID(threadID))
	if err != nil {
		return nil, err
	}
	current, window, err := s.readFlowerHistoryForObserver(ctx, meta, scope, input, flruntime.ThreadWindowInput{ThreadID: identity.ThreadID(threadID), AnchorID: input.AnchorID, Direction: input.Direction, Limit: input.Limit})
	if err != nil {
		return nil, err
	}
	current.Items, err = s.hydrateActivityTargets(ctx, meta, threadID, current.Items)
	if err != nil {
		return nil, err
	}
	evidence, err := s.flowerHistoryComputerEvidence(ctx, current.ThreadID, current.Interactions)
	if err != nil {
		return nil, err
	}
	thread, err := s.threadViewFromRecord(ctx, settings, current, &summary)
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
	// Released empty activity fields carry canonical presentation defaults.
	// Delegate this rare explicit expansion to Floret instead of duplicating
	// its historical presentation synthesis in the host.
	for _, body := range item.ActivityBodies {
		if body.Bytes != 0 {
			continue
		}
		complete, err := s.threadRuntime.View(ctx, current.ThreadID)
		if err != nil {
			return nil, err
		}
		found := false
		for _, candidate := range complete.Items {
			if candidate.ID == itemID {
				item = candidate
				found = true
				break
			}
		}
		if !found {
			return nil, flruntime.ErrThreadNotFound
		}
		break
	}
	if len(item.ActivityBodies) > 0 {
		if item.Activity == nil {
			return nil, errors.New("activity body has no activity")
		}
		var presentation *fltools.ActivityPresentation
		for _, body := range item.ActivityBodies {
			value, err := readPart(body.EntryID, flruntime.ThreadBodyActivityJSON, body.Bytes, body.SHA256)
			if err != nil {
				return nil, err
			}
			var next fltools.ActivityPresentation
			if err := json.Unmarshal([]byte(value), &next); err != nil {
				return nil, err
			}
			if err := next.Validate(); err != nil {
				return nil, err
			}
			presentation = fltools.MergeActivityPresentations(presentation, &next)
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
func (s *Service) flowerHistoryComputerEvidence(ctx context.Context, id identity.ThreadID, interactions []flruntime.ThreadInteraction) (*flruntime.ThreadView, error) {
	for _, interaction := range interactions {
		if interaction.Kind == flruntime.ThreadInteractionInput && !interaction.Resolved && interaction.Input != nil && (len(interaction.Input.EvidenceRefs) > 0 || strings.HasPrefix(interaction.ID, "tool-input:")) {
			view, err := s.threadRuntime.View(ctx, id)
			return &view, err
		}
	}
	return nil, nil
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
