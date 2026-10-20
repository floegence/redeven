package ai

import (
	"context"
	"encoding/json"
	"github.com/floegence/floret/v7/observation"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/logsafe"
	"strings"
)

// Full views are explicit test fixtures; production publishes actor mutations.
func (s *Service) publishFlowerRuntimeCurrent(endpointID string, current flruntime.ThreadView) {
	if s == nil {
		return
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID := strings.TrimSpace(current.ThreadID.String())
	if endpointID == "" || threadID == "" || current.ViewVersion == 0 {
		return
	}
	if err := s.rememberFlowerRuntimeEndpoint(threadID, endpointID); err != nil {
		if s.log != nil {
			s.log.Error("ai: reject conflicting Flower runtime view owner", "thread_id", logsafe.Text(threadID, 256), "error", err)
		}
		return
	}
	s.broadcastFlowerRuntimeProjection(endpointID, current)
}

func (s *Service) broadcastFlowerRuntimeProjection(endpointID string, current flruntime.ThreadView) {
	if s == nil {
		return
	}
	threadID := strings.TrimSpace(current.ThreadID.String())
	s.mu.Lock()
	parentThreadID := strings.TrimSpace(s.flowerRuntimeParentByThread[threadID])
	s.mu.Unlock()
	if parentThreadID == "" {
		s.broadcastFlowerRuntimeCurrent(endpointID, current)
		return
	}
	s.broadcastFlowerSubagentRuntimeCurrent(endpointID, parentThreadID, current)
	boundary := flowerSubagentInventoryBoundary(current)
	s.mu.Lock()
	if s.flowerSubagentBoundaryByThread == nil {
		s.flowerSubagentBoundaryByThread = make(map[string]string)
	}
	if s.flowerSubagentBoundaryByThread[threadID] == boundary {
		s.mu.Unlock()
		return
	}
	s.flowerSubagentBoundaryByThread[threadID] = boundary
	s.mu.Unlock()
	s.publishFlowerSubagentsPatch(context.Background(), endpointID, parentThreadID)
}

func flowerSubagentInventoryBoundary(current flruntime.ThreadView) string {
	return flowerSubagentFactsBoundary(current.TurnID.String(), flruntime.ThreadRuntimeFacts{Activity: current.Activity, Attention: current.Attention, LastOutcome: current.LastOutcome, QueueCount: len(current.Queue)})
}

func (s *Service) broadcastFlowerRuntimeCurrent(endpointID string, current flruntime.ThreadView) {
	if s == nil || strings.TrimSpace(endpointID) == "" || current.ThreadID == "" {
		return
	}
	copy := current
	envelope := FlowerLiveStreamEnvelope{
		SchemaVersion: FlowerLiveSchemaVersion,
		Kind:          FlowerLiveStreamThreadBatch,
		ThreadID:      current.ThreadID.String(),
		Current:       &copy,
	}
	batch := newFlowerLiveEncodedBatch(envelope)
	s.mu.Lock()
	for _, subscriber := range s.flowerLiveSubscribers {
		if subscriber.endpointID != endpointID || subscriber.closed {
			continue
		}
		enqueueFlowerLiveSubscriberLocked(s, subscriber, batch)
	}
	s.mu.Unlock()
	for _, status := range s.flowerComputerStatusesForCurrent(context.Background(), current, "") {
		s.publishFlowerComputerStatus(endpointID, status)
	}
}

func (s *Service) broadcastFlowerSubagentRuntimeCurrent(endpointID, parentThreadID string, current flruntime.ThreadView) {
	endpointID = strings.TrimSpace(endpointID)
	parentThreadID = strings.TrimSpace(parentThreadID)
	if s == nil || endpointID == "" || parentThreadID == "" || current.ThreadID == "" {
		return
	}
	copy := current
	batch := newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{
		SchemaVersion:   FlowerLiveSchemaVersion,
		Kind:            FlowerLiveStreamThreadBatch,
		ThreadID:        parentThreadID,
		SubagentCurrent: &copy,
	})
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, subscriber := range s.flowerLiveSubscribers {
		if subscriber.endpointID != endpointID || subscriber.closed {
			continue
		}
		enqueueFlowerLiveSubscriberLocked(s, subscriber, batch)
	}
}

func publicFloretThreadView(current flruntime.ThreadView) flruntime.ThreadView {
	current.Context = nil
	out := current
	out.ToolCallPreviews = append([]flruntime.ThreadToolCallPreview(nil), current.ToolCallPreviews...)
	for index := range out.ToolCallPreviews {
		out.ToolCallPreviews[index].Preview = out.ToolCallPreviews[index].Preview.Clone()
	}
	out.Cancellation = cloneFlowerCancellation(current.Cancellation)
	out.Items = append([]flruntime.ThreadItem(nil), current.Items...)
	for index := range out.Items {
		out.Items[index].Attachments = publicFloretAttachments(out.Items[index].Attachments)
		out.Items[index].References = publicRuntimeReferences(out.Items[index].References)
		if out.Items[index].Activity != nil {
			activity := publicActivityItem(*out.Items[index].Activity)
			out.Items[index].Activity = &activity
		}
		if out.Items[index].Interaction != nil {
			interaction := publicFloretInteraction(*out.Items[index].Interaction)
			out.Items[index].Interaction = &interaction
		}
	}
	out.Queue = append([]flruntime.QueuedInput(nil), current.Queue...)
	for index := range out.Queue {
		out.Queue[index].Input.Attachments = publicFloretAttachments(out.Queue[index].Input.Attachments)
		out.Queue[index].Input.References = publicRuntimeReferences(out.Queue[index].Input.References)
		// Supplemental context is turn-scoped host input. It is consumed by the
		// provider execution, but must not cross the public Flower projection.
		out.Queue[index].SupplementalContext = nil
	}
	out.RestoredInputs = append([]flruntime.RestoredInput(nil), current.RestoredInputs...)
	for index := range out.RestoredInputs {
		out.RestoredInputs[index].Input.Attachments = publicFloretAttachments(out.RestoredInputs[index].Input.Attachments)
		out.RestoredInputs[index].Input.References = publicRuntimeReferences(out.RestoredInputs[index].Input.References)
	}
	out.Interactions = append([]flruntime.ThreadInteraction(nil), current.Interactions...)
	for index := range out.Interactions {
		out.Interactions[index] = publicFloretInteraction(out.Interactions[index])
	}
	return out
}

func publicFloretAttachments(attachments []flruntime.MessageAttachment) []flruntime.MessageAttachment {
	out := append([]flruntime.MessageAttachment(nil), attachments...)
	for index := range out {
		out[index].ResourceRef = ""
	}
	return out
}

// Tests may materialize the public DTO into the upstream shape for assertions.
// Production paths encode the DTO directly without this round trip.
func publicActivityItem(item observation.ActivityItem) observation.ActivityItem {
	data, err := json.Marshal(projectFlowerActivity(item))
	if err != nil {
		return observation.ActivityItem{}
	}
	var out observation.ActivityItem
	if json.Unmarshal(data, &out) != nil {
		return observation.ActivityItem{}
	}
	return out
}
