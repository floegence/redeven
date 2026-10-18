package ai

import (
	"encoding/json"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	fltools "github.com/floegence/floret/v7/tools"
)

// Returned source identities are presentation facts, never navigation authority.
// Keep report text in canonical results and the existing parent event timeline.
func applyParentEventActivity(activity *fltools.ActivityPresentation, name string, data any) {
	if activity == nil || (name != "subagent_events" && name != "report_to_parent") {
		return
	}
	body, err := json.Marshal(data)
	if err != nil {
		return
	}
	if name == "report_to_parent" {
		var receipt flruntime.ParentEventReceipt
		if json.Unmarshal(body, &receipt) == nil && receipt.Accepted && receipt.EventID != "" && receipt.ParentThreadID != "" {
			activity.TargetRefs = append(activity.TargetRefs, fltools.ActivityTargetRef{Kind: "parent_event", Label: string(receipt.ParentThreadID), ResourceRef: receipt.EventID})
		}
		return
	}
	var page flruntime.ParentEventPage
	if json.Unmarshal(body, &page) != nil {
		return
	}
	seen := map[string]bool{}
	for _, event := range page.Events {
		id := string(event.SourceThreadID)
		if _, err := identity.ParseThreadID(id); err != nil || seen[id] {
			continue
		}
		seen[id] = true
		activity.TargetRefs = append(activity.TargetRefs, fltools.ActivityTargetRef{Kind: "subagent", Label: id, ResourceRef: id})
		if len(activity.TargetRefs) == 100 {
			break
		}
	}
}

func activityTargetsComplete(name string, activity *fltools.ActivityPresentation) bool {
	if name == "subagent_events" || name == "report_to_parent" {
		for _, target := range activity.TargetRefs {
			if name == "subagent_events" && target.Kind == "subagent" || name == "report_to_parent" && target.Kind == "parent_event" {
				return true
			}
		}
		return false
	}
	return fileActivityTargetsComplete(activity)
}
