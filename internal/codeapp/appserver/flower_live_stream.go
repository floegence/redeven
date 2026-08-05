package appserver

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/session"
)

const flowerLiveHeartbeatInterval = 15 * time.Second

func serveAIFlowerLiveStream(w http.ResponseWriter, r *http.Request, aiSvc *ai.Service, meta *session.Meta) {
	query := r.URL.Query()
	threadID := strings.TrimSpace(query.Get("thread_id"))
	if threadID == "" {
		writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "missing thread_id"})
		return
	}
	parseCursor := func(name string) (int64, bool) {
		raw := strings.TrimSpace(query.Get(name))
		if raw == "" {
			return 0, true
		}
		value, err := strconv.ParseInt(raw, 10, 64)
		return value, err == nil && value >= 0
	}
	generation, validGeneration := parseCursor("thread_generation")
	afterSeq, validCursor := parseCursor("thread_after_seq")
	summaryGeneration, validSummaryGeneration := parseCursor("summary_generation")
	summaryAfterSeq, validSummaryCursor := parseCursor("summary_after_seq")
	if !validGeneration || !validCursor || !validSummaryGeneration || !validSummaryCursor {
		writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid Flower live stream cursor"})
		return
	}
	subscription, err := aiSvc.SubscribeFlowerLiveStream(r.Context(), meta, ai.FlowerLiveStreamRequest{
		ThreadID: threadID, StreamGeneration: generation, AfterSeq: afterSeq,
		SummaryGeneration: summaryGeneration, SummaryAfterSeq: summaryAfterSeq,
	})
	if err != nil {
		if errors.Is(err, ai.ErrFlowerLiveTooManySubscribers) {
			w.Header().Set("Retry-After", "10")
			writeJSON(w, http.StatusTooManyRequests, apiResp{OK: false, Error: err.Error()})
			return
		}
		writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
		return
	}
	defer subscription.Close()

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
	write := func(payload []byte) error {
		if err := controller.SetWriteDeadline(time.Now().Add(5 * time.Second)); err != nil && !errors.Is(err, http.ErrNotSupported) {
			return err
		}
		if _, err := io.WriteString(w, "data: "); err != nil {
			return err
		}
		if _, err := w.Write(payload); err != nil {
			return err
		}
		if _, err := io.WriteString(w, "\n\n"); err != nil {
			return err
		}
		flusher.Flush()
		return nil
	}
	for {
		frameCtx, cancel := context.WithTimeout(r.Context(), flowerLiveHeartbeatInterval)
		frame, err := subscription.Next(frameCtx)
		cancel()
		if errors.Is(err, context.DeadlineExceeded) && r.Context().Err() == nil {
			if _, err := io.WriteString(w, ": heartbeat\n\n"); err != nil {
				return
			}
			flusher.Flush()
			continue
		}
		if err != nil {
			return
		}
		if frame == nil || write(frame.Data) != nil {
			return
		}
		if frame.Kind == ai.FlowerLiveStreamResyncRequired {
			return
		}
	}
}
