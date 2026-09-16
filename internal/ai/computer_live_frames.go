package ai

import (
	"context"
	"errors"
	"strconv"
	"time"
)

type computerLiveSampler struct {
	awaitingRead bool
	cancel       context.CancelFunc
	done         chan struct{}
	request      ComputerViewerRequest
	frames       []computerLiveImage
}
type computerLiveImage struct {
	frame FlowerComputerFrame
	body  []byte
}
type computerLiveRequest struct {
	ComputerViewerRequest
	privateCall TargetToolCall
	validate    func(context.Context) error
}

const computerLiveFrameInterval = time.Second / 3

func computerFrameInterval(fps int) (time.Duration, error) {
	switch fps {
	case 0, 3:
		return computerLiveFrameInterval, nil
	case 5, 10, 15, 30:
		return time.Second / time.Duration(fps), nil
	}
	return 0, errors.New("invalid computer frame rate")
}

// One bounded sampler owns either public observations or observer-private pixels.
// Input waiters acquire the target before another passive sample can start.
func (r *ComputerUseRuntime) startComputerLiveFrames(ctx context.Context, request computerLiveRequest, publish func(FlowerComputerFrame)) (func(), error) {
	if r == nil || publish == nil || request.ThreadID == "" || request.ObserverID == "" || request.TargetID == "" {
		return nil, errors.New("invalid computer live frame session")
	}
	interval, err := computerFrameInterval(request.FPS)
	if err != nil {
		return nil, err
	}
	private := request.InteractionID != ""
	call := TargetToolCall{liveFrame: true, ThreadID: request.ThreadID, TargetID: request.TargetID, ToolName: "computer.screenshot"}
	if private {
		if request.validate == nil {
			return nil, errors.New("missing private viewer authority")
		}
		call = request.privateCall
		call.ToolName, call.Arguments, call.userInput, call.liveFrame = "computer.screenshot", nil, true, true
	}
	_, release, err := r.acquireComputerControl(ctx, call)
	if err != nil {
		return nil, err
	}
	if request.validate != nil {
		err = request.validate(ctx)
	}
	release()
	if err != nil {
		return nil, err
	}
	key := request.ObserverID
	r.mu.Lock()
	if r.closed || ctx.Err() != nil {
		r.mu.Unlock()
		return nil, errors.New("computer viewer unavailable")
	}
	if len(r.liveFrames) >= 8 || r.liveFrames[key] != nil {
		r.mu.Unlock()
		return nil, errors.New("computer live viewer limit reached")
	}
	if r.liveFrames == nil {
		r.liveFrames = make(map[string]*computerLiveSampler)
	}
	liveCtx, cancel := context.WithCancel(ctx)
	sampler := &computerLiveSampler{cancel: cancel, done: make(chan struct{}), request: request.ComputerViewerRequest}
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
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		var sequence uint64
		capture := func() bool {
			call.passiveCapture = true
			control, unlock, err := r.acquireComputerControl(liveCtx, call)
			if errors.Is(err, errComputerCaptureBusy) {
				return true
			}
			var result TargetToolResult
			var body []byte
			if err == nil {
				// A closed viewer drains its already dispatched screenshot without killing
				// the shared browser helper. Validation and lock admission remain cancelable.
				if request.validate != nil {
					err = request.validate(liveCtx)
				}
				if err == nil {
					r.mu.RLock()
					waiting := sampler.awaitingRead
					r.mu.RUnlock()
					if waiting {
						unlock()
						return true
					}
				}
				if err == nil {
					captureCtx, done := context.WithTimeout(context.WithoutCancel(liveCtx), 5*time.Second)
					if private {
						control.mu.Lock()
						control.threadID, control.turnID, control.runID, control.user = call.ThreadID, call.TurnID, call.RunID, true
						control.mu.Unlock()
						body, err = r.executeComputerUserInputLocked(captureCtx, call)
					} else {
						result, err = r.executeComputerToolLocked(captureCtx, call, control)
						if err == nil && len(result.Attachments) != 1 {
							err = errors.New("computer observation unavailable")
						}
						if err == nil {
							body = result.frameBytes
							err = validateComputerFrame(result.Attachments[0], body)
						}
					}
					done()
				}
				unlock()
			}
			if liveCtx.Err() != nil {
				return false
			}
			sequence++
			frame := FlowerComputerFrame{ThreadID: request.ThreadID, SessionID: request.ObserverID, TargetID: request.TargetID, ViewerRevision: request.Revision, InteractionID: request.InteractionID, MIMEType: "image/png", Sequence: sequence, CapturedAtMS: time.Now().UnixMilli()}
			if err != nil {
				frame.ErrorCode = "computer_view_unavailable"
				publish(frame)
				return false
			}
			if private {
				frame.FrameID = strconv.FormatUint(sequence, 10)
			} else {
				frame.ResourceRef, frame.SHA256 = result.Attachments[0].ResourceRef, result.Attachments[0].SHA256
			}
			r.mu.Lock()
			sampler.frames = append(sampler.frames, computerLiveImage{frame: frame, body: body})
			sampler.awaitingRead = true
			if len(sampler.frames) > 2 {
				sampler.frames = append([]computerLiveImage(nil), sampler.frames[len(sampler.frames)-2:]...)
			}
			r.mu.Unlock()
			publish(frame)
			return true
		}
		if !capture() {
			return
		}
		for {
			select {
			case <-liveCtx.Done():
				return
			case <-ticker.C:
				if !capture() {
					return
				}
			}
		}
	}()
	return stop, nil
}

// Public media lookup never resolves private viewing frames.
func (r *ComputerUseRuntime) ResolveComputerLiveFrame(ctx context.Context, threadID, targetID, ref string) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	var body []byte
	for _, sampler := range r.liveFrames {
		if sampler.request.InteractionID != "" || sampler.request.ThreadID != threadID || sampler.request.TargetID != targetID {
			continue
		}
		for _, frame := range sampler.frames {
			if frame.frame.ResourceRef == ref {
				if sampler.frames[len(sampler.frames)-1].frame.ResourceRef == ref {
					sampler.awaitingRead = false
				}
				body = frame.body
			}
		}
	}
	if body != nil {
		return append([]byte(nil), body...), nil
	}
	return nil, errors.New("computer live frame is unavailable")
}

func (r *ComputerUseRuntime) resolvePrivateComputerFrame(request ComputerPrivateFrameRequest) ([]byte, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	sampler := r.liveFrames[request.ObserverID]
	if sampler != nil && sampler.request.Revision == request.ViewerRevision && sampler.request.ThreadID == request.ThreadID && sampler.request.InteractionID == request.InteractionID && request.InteractionID != "" {
		for _, frame := range sampler.frames {
			if frame.frame.FrameID == request.FrameID {
				if sampler.frames[len(sampler.frames)-1].frame.FrameID == request.FrameID {
					sampler.awaitingRead = false
				}
				return append([]byte(nil), frame.body...), nil
			}
		}
	}
	return nil, errors.New("private computer frame unavailable")
}
