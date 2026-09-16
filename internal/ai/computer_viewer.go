package ai

import (
	"context"
	"errors"
	"sync"

	"github.com/floegence/redeven/internal/session"
)

// ComputerViewerRequest selects ephemeral media on an existing workspace
// observer. A blank ThreadID closes viewing; it never cancels a model turn.
type ComputerViewerRequest struct {
	FPS           int    `json:"fps,omitempty"`
	InteractionID string `json:"interaction_id,omitempty"`
	ObserverID    string `json:"observer_id"`
	Revision      uint64 `json:"revision"`
	ThreadID      string `json:"thread_id,omitempty"`
	TargetID      string `json:"target_id,omitempty"`
	ResourceRef   string `json:"resource_ref,omitempty"`
}

func (s *Service) SetComputerViewer(ctx context.Context, meta *session.Meta, request ComputerViewerRequest) error {
	if err := requireRead(meta); err != nil {
		return err
	}
	if _, err := computerFrameInterval(request.FPS); err != nil {
		return err
	}
	if request.ThreadID != "" && request.InteractionID != "" {
		call, err := s.pendingComputerControl(ctx, meta, request.ThreadID, request.InteractionID)
		if err != nil {
			return err
		}
		if call.TargetID != request.TargetID || request.ResourceRef != "" {
			return errors.New("invalid private viewer target")
		}
	} else if request.ThreadID != "" {
		// A user may watch only a target already observed by this thread. Merely
		// knowing a target ID never authorizes a new capture session.
		if _, err := s.ResolveTargetToolAttachmentForThread(ctx, meta, request.ThreadID, request.TargetID, request.ResourceRef); err != nil {
			return err
		}
	}
	return s.setComputerViewer(ctx, meta, request)
}

func (s *Service) setComputerViewer(ctx context.Context, meta *session.Meta, request ComputerViewerRequest) (resultErr error) {
	if err := requireRead(meta); err != nil {
		return err
	}
	if request.ObserverID == "" || request.Revision == 0 {
		return errors.New("invalid computer viewer")
	}
	s.mu.Lock()
	var subscriber *flowerLiveSubscriber
	for _, candidate := range s.flowerLiveSubscribers {
		if candidate.observerID == request.ObserverID && candidate.endpointID == meta.EndpointID && candidate.userPublicID == meta.UserPublicID && !candidate.closed {
			subscriber = candidate
			break
		}
	}
	s.mu.Unlock()
	if subscriber == nil {
		return errors.New("computer viewer connection unavailable")
	}
	subscriber.viewerMu.Lock()
	defer subscriber.viewerMu.Unlock()
	defer func() {
		if resultErr != nil {
			s.mu.Lock()
			if subscriber.viewerRequest.Revision == request.Revision {
				subscriber.viewerRequest = ComputerViewerRequest{}
			}
			s.mu.Unlock()
		}
	}()
	s.mu.Lock()
	if subscriber.closed || request.Revision <= subscriber.viewerRevision {
		s.mu.Unlock()
		return errors.New("computer viewer command expired")
	}
	subscriber.viewerRevision = request.Revision
	subscriber.viewerRequest = request
	select {
	case <-subscriber.media:
	default:
	}
	oldStop := subscriber.viewerStop
	if subscriber.viewerCancel != nil {
		subscriber.viewerCancel()
	}
	subscriber.viewerCancel, subscriber.viewerStop = nil, nil
	s.mu.Unlock()
	if oldStop != nil {
		oldStop()
	}
	if request.ThreadID == "" {
		return nil
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	if subscriber.closed {
		s.mu.Unlock()
		return errors.New("computer viewer connection unavailable")
	}
	runtime, ok := s.targetToolExecutor.(*ComputerUseRuntime)
	if !ok {
		s.mu.Unlock()
		return errors.New("computer viewer runtime unavailable")
	}
	liveCtx, cancel := context.WithCancel(subscriber.observerContext)
	subscriber.viewerCancel = cancel
	s.mu.Unlock()
	capture := computerLiveRequest{ComputerViewerRequest: request}
	if request.InteractionID != "" {
		call, err := s.pendingComputerControl(ctx, meta, request.ThreadID, request.InteractionID)
		if err != nil {
			cancel()
			return err
		}
		capture.privateCall = call
		capture.validate = func(ctx context.Context) error {
			current, err := s.pendingComputerControl(ctx, meta, request.ThreadID, request.InteractionID)
			if err != nil {
				return err
			}
			if current.TargetID != call.TargetID || current.RunID != call.RunID || current.TurnID != call.TurnID {
				return ErrWaitingPromptChanged
			}
			return s.requirePrivateComputerViewer(meta, request.ObserverID, request.Revision, request.ThreadID, request.InteractionID)
		}
	}
	stop, err := runtime.startComputerLiveFrames(liveCtx, capture, func(frame FlowerComputerFrame) {
		// Deliver only to the observer that requested this capture.
		batch := newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamComputerFrame, ThreadID: request.ThreadID, ComputerFrame: &frame})
		s.mu.Lock()
		defer s.mu.Unlock()
		if subscriber.closed || liveCtx.Err() != nil {
			return
		}
		select {
		case <-subscriber.media:
		default:
		}
		if frame.ErrorCode != "" {
			subscriber.viewerRequest = ComputerViewerRequest{}
		}
		subscriber.media <- batch
	})
	if err != nil {
		cancel()
		return err
	}
	// stop is also safe after connection teardown has cancelled capture.
	s.mu.Lock()
	subscriber.viewerStop = sync.OnceFunc(stop)
	s.mu.Unlock()
	return nil
}

// Private frame IDs are meaningful only inside the exact active viewer.
type ComputerPrivateFrameRequest struct {
	ObserverID     string `json:"observer_id"`
	ViewerRevision uint64 `json:"viewer_revision"`
	ThreadID       string `json:"thread_id"`
	InteractionID  string `json:"interaction_id"`
	FrameID        string `json:"frame_id"`
}

func (s *Service) requirePrivateComputerViewer(meta *session.Meta, observerID string, revision uint64, threadID, interactionID string) error {
	if err := requireRWX(meta); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, subscriber := range s.flowerLiveSubscribers {
		request := subscriber.viewerRequest
		if !subscriber.closed && subscriber.observerID == observerID && subscriber.endpointID == meta.EndpointID && subscriber.userPublicID == meta.UserPublicID && request.Revision == revision && revision > 0 && request.ThreadID == threadID && request.InteractionID == interactionID && interactionID != "" {
			return nil
		}
	}
	return errors.New("private computer viewer unavailable")
}

func (s *Service) ReadPrivateComputerFrame(ctx context.Context, meta *session.Meta, request ComputerPrivateFrameRequest) ([]byte, error) {
	if _, err := s.pendingComputerControl(ctx, meta, request.ThreadID, request.InteractionID); err != nil {
		return nil, err
	}
	if err := s.requirePrivateComputerViewer(meta, request.ObserverID, request.ViewerRevision, request.ThreadID, request.InteractionID); err != nil {
		return nil, err
	}
	runtime, ok := s.targetToolExecutor.(*ComputerUseRuntime)
	if !ok {
		return nil, errors.New("computer viewer unavailable")
	}
	return runtime.resolvePrivateComputerFrame(request)
}
