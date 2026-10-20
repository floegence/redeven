package ai

import (
	flruntime "github.com/floegence/floret/v7/runtime"
	"strings"
	"testing"
)

// Tests reconstruct public state to detect omitted, duplicate, or corrupt facts.
func applyFlowerTestUpdate(t *testing.T, view *flruntime.ThreadView, update flruntime.ThreadUpdate) {
	t.Helper()
	if update.ViewVersion <= view.ViewVersion {
		return
	}
	if update.ThreadID != view.ThreadID || update.BaseVersion != view.ViewVersion {
		t.Fatalf("noncontinuous update: baseline=%s/%d update=%s/%d->%d", view.ThreadID, view.ViewVersion, update.ThreadID, update.BaseVersion, update.ViewVersion)
	}
	for _, change := range update.Items {
		index := -1
		for i := range view.Items {
			if view.Items[i].ID == change.ItemID {
				index = i
				break
			}
		}
		switch change.Kind {
		case flruntime.ThreadItemAdded:
			if index >= 0 || change.Item == nil {
				t.Fatal("invalid item addition")
			}
			view.Items = append(view.Items, *change.Item)
		case flruntime.ThreadItemReplaced:
			if index < 0 || change.Item == nil {
				t.Fatal("invalid item replacement")
			}
			view.Items[index] = *change.Item
		case flruntime.ThreadItemRemoved:
			if index < 0 {
				t.Fatal("invalid item removal")
			}
			view.Items = append(view.Items[:index], view.Items[index+1:]...)
		case flruntime.ThreadItemAppended:
			if index < 0 || change.Append == nil || len(view.Items[index].Text) != change.Append.OffsetBytes {
				t.Fatal("invalid text append")
			}
			view.Items[index].Text += change.Append.Text
		default:
			t.Fatal("unknown item change")
		}
	}
	if update.ItemOrder != nil {
		ordered := make([]flruntime.ThreadItem, 0, len(update.ItemOrder.Value))
		for _, id := range update.ItemOrder.Value {
			for _, item := range view.Items {
				if item.ID == id {
					ordered = append(ordered, item)
					break
				}
			}
		}
		if len(ordered) != len(view.Items) {
			t.Fatal("incomplete item order")
		}
		view.Items = ordered
	}
	view.TurnID, view.RunID, view.ViewVersion = update.TurnID, update.RunID, update.ViewVersion
	view.Activity, view.Attention, view.TurnKind = update.Facts.Activity, update.Facts.Attention, update.Facts.TurnKind
	view.LastOutcome, view.RunProgress, view.Cancellation = update.Facts.LastOutcome, update.Facts.RunProgress, update.Facts.Cancellation
	if update.Turns != nil {
		view.Turns = update.Turns.Value
	}
	if update.Queue != nil {
		view.Queue = update.Queue.Value
	}
	if update.Interactions != nil {
		view.Interactions = update.Interactions.Value
	}
	if update.Goal != nil {
		view.Goal = update.Goal.Value
	}
	if update.ParentEvents != nil {
		view.ParentEvents = update.ParentEvents.Value
	}
	if update.ToolCallPreviews != nil {
		view.ToolCallPreviews = update.ToolCallPreviews.Value
	}
	if update.RestoredInputs != nil {
		view.RestoredInputs = update.RestoredInputs.Value
	}
}
func flowerTestHasText(view flruntime.ThreadView, text string) bool {
	for _, item := range view.Items {
		if strings.Contains(item.Text, text) {
			return true
		}
	}
	return false
}
