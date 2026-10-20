package ai

import (
	"encoding/json"
	"strings"

	"github.com/floegence/floret/v7/identity"
	"github.com/floegence/floret/v7/observation"
)

const activityTimelineBlockType = "activity-timeline"

type ActivityTimelineBlock struct {
	Type string `json:"type"`
	observation.ActivityTimeline
}

func (block ActivityTimelineBlock) MarshalJSON() ([]byte, error) {
	type timeline observation.ActivityTimeline
	items := make([]flowerPublicActivity, len(block.Items))
	for index, item := range block.Items {
		items[index] = projectFlowerActivity(item)
	}
	return json.Marshal(struct {
		Type string `json:"type"`
		timeline
		Items []flowerPublicActivity `json:"items"`
	}{block.Type, timeline(block.ActivityTimeline), items})
}

type activityTimelinePublicIdentity struct {
	RunID    string
	ThreadID string
	TurnID   string
	TraceID  string
}

func newActivityTimelineBlock(timeline observation.ActivityTimeline) ActivityTimelineBlock {
	return newActivityTimelineBlockWithPublicIdentity(timeline, activityTimelinePublicIdentity{})
}

func newActivityTimelineBlockWithPublicIdentity(timeline observation.ActivityTimeline, publicIdentity activityTimelinePublicIdentity) ActivityTimelineBlock {
	if timeline.SchemaVersion <= 0 {
		timeline.SchemaVersion = observation.ActivityTimelineSchemaVersion
	}
	timeline = publicActivityTimelineForBlock(timeline, publicIdentity)
	return ActivityTimelineBlock{
		Type:             activityTimelineBlockType,
		ActivityTimeline: timeline,
	}
}

func publicActivityTimelineForBlock(timeline observation.ActivityTimeline, publicIdentity activityTimelinePublicIdentity) observation.ActivityTimeline {
	timeline.RunID = identity.RunID(strings.TrimSpace(publicIdentity.RunID))
	timeline.ThreadID = identity.ThreadID(strings.TrimSpace(publicIdentity.ThreadID))
	timeline.TurnID = identity.TurnID(strings.TrimSpace(publicIdentity.TurnID))
	timeline.TraceID = identity.TraceID(strings.TrimSpace(publicIdentity.TraceID))
	return timeline
}

func activityTimelineFromAny(block any) (observation.ActivityTimeline, bool) {
	switch v := block.(type) {
	case ActivityTimelineBlock:
		return v.ActivityTimeline, true
	case *ActivityTimelineBlock:
		if v != nil {
			return v.ActivityTimeline, true
		}
	case observation.ActivityTimeline:
		return v, true
	case *observation.ActivityTimeline:
		if v != nil {
			return *v, true
		}
	case map[string]any:
		if strings.TrimSpace(anyToString(v["type"])) != activityTimelineBlockType {
			return observation.ActivityTimeline{}, false
		}
		raw, err := json.Marshal(v)
		if err != nil {
			return observation.ActivityTimeline{}, false
		}
		var out ActivityTimelineBlock
		if err := json.Unmarshal(raw, &out); err != nil {
			return observation.ActivityTimeline{}, false
		}
		return out.ActivityTimeline, true
	}
	return observation.ActivityTimeline{}, false
}
