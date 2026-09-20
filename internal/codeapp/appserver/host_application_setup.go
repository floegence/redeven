package appserver

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/hostapps"
)

// Setup inherits the Host Applications route's origin, permission and user owner.
func (g *Server) handleHostApplicationSetup(w http.ResponseWriter, r *http.Request, owner string) {
	path := strings.TrimPrefix(r.URL.Path, hostApplicationsAPI+"/setup")
	var status hostapps.SetupStatus
	var err error
	switch {
	case path == "" && r.Method == http.MethodGet:
		status, err = g.hostApps.SetupStatus(owner)
	case path == "" && r.Method == http.MethodPost:
		var req struct {
			RequestID string `json:"request_id"`
			Source    string `json:"source"`
			Size      int64  `json:"size_bytes"`
		}
		if decodeManagedJSON(r, &req) != nil {
			writeHostAppError(w, hostapps.ErrInvalid)
			return
		}
		status, err = g.hostApps.StartSetup(owner, req.RequestID, req.Source, req.Size)
	case path == "/events" && r.Method == http.MethodGet:
		g.streamHostApplicationSetup(w, r, owner)
		return
	default:
		parts := strings.Split(strings.TrimPrefix(path, "/"), "/")
		if len(parts) < 1 || parts[0] == "" {
			writeHostAppError(w, hostapps.ErrNotFound)
			return
		}
		id := parts[0]
		switch {
		case len(parts) == 1 && r.Method == http.MethodDelete:
			status, err = g.hostApps.CancelSetup(owner, id)
		case len(parts) == 2 && parts[1] == "complete" && r.Method == http.MethodPost:
			status, err = g.hostApps.CompleteSetup(owner, id)
		case len(parts) == 2 && parts[1] == "content" && r.Method == http.MethodPut:
			offset, parseErr := strconv.ParseInt(r.URL.Query().Get("offset"), 10, 64)
			if parseErr != nil || offset < 0 {
				writeHostAppError(w, hostapps.ErrInvalid)
				return
			}
			data, readErr := io.ReadAll(io.LimitReader(r.Body, (256<<10)+1))
			if readErr != nil || len(data) > 256<<10 {
				writeHostAppError(w, hostapps.ErrInvalid)
				return
			}
			status, err = g.hostApps.WriteSetup(owner, id, offset, data)
		default:
			writeHostAppError(w, hostapps.ErrNotFound)
			return
		}
	}
	if err != nil {
		writeHostAppError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, apiResp{OK: true, Data: status})
}
func (g *Server) streamHostApplicationSetup(w http.ResponseWriter, r *http.Request, owner string) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeHostAppError(w, hostapps.ErrUnavailable)
		return
	}
	changes, stop, err := g.hostApps.WatchSetup()
	if err != nil {
		writeHostAppError(w, err)
		return
	}
	defer stop()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("X-Accel-Buffering", "no")
	heartbeat := time.NewTicker(20 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-changes:
			status, err := g.hostApps.SetupStatus(owner)
			if err != nil {
				return
			}
			data, err := json.Marshal(status)
			if err != nil {
				return
			}
			if _, err = fmt.Fprintf(w, "event: setup\ndata: %s\n\n", data); err != nil {
				return
			}
			flusher.Flush()
		case <-heartbeat.C:
			if _, err = io.WriteString(w, ": keepalive\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}
