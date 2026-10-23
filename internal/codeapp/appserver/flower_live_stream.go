package appserver

import (
	"context"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/session"
)

const (
	flowerLiveHeartbeatInterval = 15 * time.Second
	flowerLiveWriteTimeout      = 5 * time.Second
)

func serveAIFlowerLiveStream(w http.ResponseWriter, r *http.Request, aiSvc *ai.Service, meta *session.Meta) {
	serveAIFlowerLiveStreamWithTiming(w, r, aiSvc, meta, flowerLiveHeartbeatInterval, flowerLiveWriteTimeout)
}

func serveAIFlowerLiveStreamWithTiming(
	w http.ResponseWriter,
	r *http.Request,
	aiSvc *ai.Service,
	meta *session.Meta,
	heartbeatInterval time.Duration,
	writeTimeout time.Duration,
) {
	subscription, err := aiSvc.SubscribeFlowerLiveStream(r.Context(), meta, ai.FlowerLiveStreamRequest{})
	if err != nil {
		writeFlowerLiveSubscriptionError(w, err)
		return
	}
	defer subscription.Close()
	serveFlowerLiveStreamFrames(w, r, subscription, heartbeatInterval, writeTimeout)
}

func writeFlowerLiveSubscriptionError(w http.ResponseWriter, err error) {
	status := http.StatusBadRequest
	switch {
	case errors.Is(err, ai.ErrFlowerLiveTooManySubscribers):
		w.Header().Set("Retry-After", "10")
		status = http.StatusTooManyRequests
	case errors.Is(err, ai.ErrFlowerLiveSync):
		// A recovering runtime subscription needs a fresh baseline, not user action.
		status = http.StatusServiceUnavailable
	case errors.Is(err, context.DeadlineExceeded):
		status = http.StatusGatewayTimeout
	}
	writeJSON(w, status, apiResp{OK: false, Error: err.Error()})
}

type flowerLiveStreamReader interface {
	Next(context.Context) (*ai.FlowerLiveStreamFrame, error)
}

func serveFlowerLiveStreamFrames(w http.ResponseWriter, r *http.Request, subscription flowerLiveStreamReader, heartbeatInterval, writeTimeout time.Duration) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, apiResp{OK: false, Error: "streaming response is unavailable"})
		return
	}
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	controller := http.NewResponseController(w)
	write := func(prefix string, payload []byte) (writeErr error) {
		if err := controller.SetWriteDeadline(time.Now().Add(writeTimeout)); err != nil && !errors.Is(err, http.ErrNotSupported) {
			return err
		}
		defer func() {
			if err := controller.SetWriteDeadline(time.Time{}); writeErr == nil && err != nil && !errors.Is(err, http.ErrNotSupported) {
				writeErr = err
			}
		}()
		if _, err := io.WriteString(w, prefix); err != nil {
			return err
		}
		if len(payload) > 0 {
			if _, err := w.Write(payload); err != nil {
				return err
			}
		}
		if _, err := io.WriteString(w, "\n\n"); err != nil {
			return err
		}
		flusher.Flush()
		return nil
	}
	for {
		frameCtx, cancel := context.WithTimeout(r.Context(), heartbeatInterval)
		frame, err := subscription.Next(frameCtx)
		cancel()
		if errors.Is(err, context.DeadlineExceeded) && r.Context().Err() == nil {
			if write(": heartbeat", nil) != nil {
				return
			}
			continue
		}
		if err != nil {
			if errors.Is(err, ai.ErrFlowerLiveSync) {
				// Lost observation continuity requires a fresh authorized baseline.
				// Keep this fixed public message independent of private data.
				_ = write("event: error\ndata: ", []byte(`{"code":"flower_live_sync_error","message":"Flower live stream synchronization failed"}`))
			}
			return
		}
		if frame == nil || write("data: ", frame.Data) != nil {
			return
		}
	}
}
