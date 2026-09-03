package appserver

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/pluginmarket"
)

func (g *Server) handlePluginMarketEventStream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, apiResp{OK: false, Error: "streaming not supported"})
		return
	}

	query, queryErr := url.ParseQuery(r.URL.RawQuery)
	afterValues := query["after_seq"]
	if queryErr != nil || len(query) > 1 || (len(query) == 1 && len(afterValues) == 0) || len(afterValues) > 1 {
		writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid after_seq"})
		return
	}
	afterSeq := int64(0)
	if len(afterValues) == 1 {
		raw := strings.TrimSpace(afterValues[0])
		value, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || value < 0 || strconv.FormatInt(value, 10) != raw {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid after_seq"})
			return
		}
		afterSeq = value
	}
	if g.pluginMarketSubscribe == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "plugin market is unavailable"})
		return
	}

	baseline, events, err := g.pluginMarketSubscribe(r.Context(), afterSeq)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "plugin market is unavailable"})
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Connection", "keep-alive")
	for _, event := range baseline {
		if err := writePluginMarketSSEEvent(w, event); err != nil {
			return
		}
	}
	flusher.Flush()

	heartbeat := time.NewTicker(20 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case event, ok := <-events:
			if !ok {
				return
			}
			if err := writePluginMarketSSEEvent(w, event); err != nil {
				return
			}
			flusher.Flush()
		case <-heartbeat.C:
			if _, err := io.WriteString(w, ": keepalive\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func writePluginMarketSSEEvent(w io.Writer, event pluginmarket.RefreshEvent) error {
	raw, err := json.Marshal(event)
	if err != nil {
		return err
	}
	if _, err := io.WriteString(w, "event: message\n"); err != nil {
		return err
	}
	if _, err := io.WriteString(w, "data: "); err != nil {
		return err
	}
	if _, err := w.Write(raw); err != nil {
		return err
	}
	_, err = io.WriteString(w, "\n\n")
	return err
}
