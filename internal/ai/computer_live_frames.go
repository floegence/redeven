package ai

import (
	"context"
	"errors"
	"time"
)

const computerLiveFrameInterval = 333 * time.Millisecond

// StartComputerLiveFrames starts the single target-scoped live sampler. It
// keeps no durable state and drops naturally at the publisher boundary; the
// returned stop function is idempotent and must be called when the viewer or
// takeover session ends.
func (r *ComputerUseRuntime) StartComputerLiveFrames(ctx context.Context, threadID, sessionID, targetID string, publish func(FlowerComputerFrame)) (func(), error) {
	if r == nil || publish == nil || threadID == "" || sessionID == "" || targetID == "" {
		return nil, errors.New("invalid computer live frame session")
	}
	key := threadID + "\x00" + sessionID + "\x00" + targetID
	r.mu.Lock()
	if r.liveFrames == nil {
		r.liveFrames = make(map[string]context.CancelFunc)
	}
	if _, exists := r.liveFrames[key]; exists {
		r.mu.Unlock()
		return nil, errors.New("computer live frame session already exists")
	}
	liveCtx, cancel := context.WithCancel(ctx)
	r.liveFrames[key] = cancel
	r.mu.Unlock()
	stop := func() {
		r.mu.Lock()
		if current, ok := r.liveFrames[key]; ok {
			delete(r.liveFrames, key)
			current()
		}
		r.mu.Unlock()
	}
	go func() {
		defer stop()
		ticker := time.NewTicker(computerLiveFrameInterval)
		defer ticker.Stop()
		capture := func() {
			result, err := r.ExecuteTargetTool(liveCtx, TargetToolCall{TargetID: targetID, ToolName: "computer.screenshot", Arguments: []byte(`{"target":"` + targetID + `"}`)})
			if err != nil || len(result.Attachments) == 0 {
				return
			}
			attachment := result.Attachments[len(result.Attachments)-1]
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
