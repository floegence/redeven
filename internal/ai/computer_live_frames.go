package ai

import (
	"context"
	"errors"
	"time"
)

type computerLiveSampler struct {
	cancel   context.CancelFunc
	done     chan struct{}
	threadID string
	targetID string
	frames   []computerLiveImage
}

type computerLiveImage struct {
	attachment TargetToolAttachment
	body       []byte
}

const computerLiveFrameInterval = 333 * time.Millisecond

// StartComputerLiveFrames starts the single target-scoped live sampler. It
// keeps no durable state; the
// returned stop function waits for capture to finish and must be called when the viewer or
// takeover session ends.
func (r *ComputerUseRuntime) StartComputerLiveFrames(ctx context.Context, threadID, sessionID, targetID string, publish func(FlowerComputerFrame)) (func(), error) {
	if r == nil || publish == nil || threadID == "" || sessionID == "" || targetID == "" {
		return nil, errors.New("invalid computer live frame session")
	}
	key := threadID + "\x00" + sessionID + "\x00" + targetID
	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		return nil, errors.New("computer use runtime is closed")
	}
	if err := ctx.Err(); err != nil {
		r.mu.Unlock()
		return nil, err
	}
	if len(r.liveFrames) >= 8 {
		r.mu.Unlock()
		return nil, errors.New("computer live viewer limit reached")
	}
	if r.liveFrames == nil {
		r.liveFrames = make(map[string]*computerLiveSampler)
	}
	if _, exists := r.liveFrames[key]; exists {
		r.mu.Unlock()
		return nil, errors.New("computer live frame session already exists")
	}
	liveCtx, cancel := context.WithCancel(ctx)
	sampler := &computerLiveSampler{cancel: cancel, done: make(chan struct{}), threadID: threadID, targetID: targetID}
	r.liveFrames[key] = sampler
	r.liveWG.Add(1)
	r.mu.Unlock()
	stop := func() { cancel(); <-sampler.done }
	go func() {
		defer r.liveWG.Done()
		defer func() {
			cancel()
			r.mu.Lock()
			if r.liveFrames[key] == sampler {
				delete(r.liveFrames, key)
			}
			r.mu.Unlock()
			close(sampler.done)
		}()
		ticker := time.NewTicker(computerLiveFrameInterval)
		defer ticker.Stop()
		capture := func() {
			result, err := r.ExecuteTargetTool(liveCtx, TargetToolCall{liveFrame: true, ThreadID: threadID, TargetID: targetID, ToolName: "computer.screenshot", Arguments: []byte(`{"target":"` + targetID + `"}`)})
			if err != nil || len(result.Attachments) == 0 {
				return
			}
			attachment := result.Attachments[len(result.Attachments)-1]
			if validateComputerFrame(attachment, result.frameBytes) != nil || liveCtx.Err() != nil {
				return
			}
			r.mu.Lock()
			sampler.frames = append(sampler.frames, computerLiveImage{attachment: attachment, body: result.frameBytes})
			if len(sampler.frames) > 2 {
				sampler.frames = append([]computerLiveImage(nil), sampler.frames[len(sampler.frames)-2:]...)
			}
			r.mu.Unlock()
			publish(FlowerComputerFrame{ThreadID: threadID, SessionID: sessionID, TargetID: targetID, ResourceRef: attachment.ResourceRef, SHA256: attachment.SHA256, MIMEType: attachment.MIMEType, Sequence: uint64(time.Now().UnixNano()), CapturedAtMS: time.Now().UnixMilli()})
		}
		capture()
		for {
			select {
			case <-liveCtx.Done():
				return
			case <-ticker.C:
				capture()
			}
		}
	}()
	return stop, nil
}

// ResolveComputerLiveFrame authorizes only frames captured by this active
// thread/target session. These images never enter the keyframe store.
func (r *ComputerUseRuntime) ResolveComputerLiveFrame(ctx context.Context, threadID, targetID, ref string) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, sampler := range r.liveFrames {
		if sampler.threadID != threadID || sampler.targetID != targetID {
			continue
		}
		for _, frame := range sampler.frames {
			if frame.attachment.ResourceRef == ref {
				return append([]byte(nil), frame.body...), nil
			}
		}
	}
	return nil, errors.New("computer live frame is unavailable")
}
