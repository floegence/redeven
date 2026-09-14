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
	ObserverID  string `json:"observer_id"`
	Revision    uint64 `json:"revision"`
	ThreadID    string `json:"thread_id,omitempty"`
	TargetID    string `json:"target_id,omitempty"`
	ResourceRef string `json:"resource_ref,omitempty"`
}

func (s *Service) SetComputerViewer(ctx context.Context, meta *session.Meta, request ComputerViewerRequest) error {
	if err := requireRead(meta); err != nil {
		return err
	}
	if request.ThreadID != "" {
		// A user may watch only a target already observed by this thread. Merely
		// knowing a target ID never authorizes a new capture session.
		if _, err := s.ResolveTargetToolAttachmentForThread(ctx, meta, request.ThreadID, request.TargetID, request.ResourceRef); err != nil {
			return err
		}
	}
	return s.setComputerViewer(ctx, meta, request)
}

func (s *Service) setComputerViewer(ctx context.Context, meta *session.Meta, request ComputerViewerRequest) error {
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
	s.mu.Lock()
	if subscriber.closed || request.Revision <= subscriber.viewerRevision {
		s.mu.Unlock()
		return errors.New("computer viewer command expired")
	}
	subscriber.viewerRevision = request.Revision
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
	stop, err := runtime.StartComputerLiveFrames(liveCtx, request.ThreadID, subscriber.observerID, request.TargetID, func(frame FlowerComputerFrame) {
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
		subscriber.media <- batch
	})
	if err != nil {
		cancel()
		return err
	}
	// stop is also safe after connection teardown has cancelled capture.
	subscriber.viewerStop = sync.OnceFunc(stop)
	return nil
}
