package gateway

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/workbenchlayout"
)

const workbenchLayoutConflictErrorCode = "WORKBENCH_LAYOUT_REVISION_CONFLICT"

func (g *Gateway) handleWorkbenchLayoutAPI(w http.ResponseWriter, r *http.Request) bool {
	if r == nil || !strings.HasPrefix(strings.TrimSpace(r.URL.Path), "/_redeven_proxy/api/workbench/layout") {
		return false
	}
	if g == nil || g.layouts == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "workbench layout service not ready"})
		return true
	}

	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/_redeven_proxy/api/workbench/layout/snapshot":
		if _, ok := g.requirePermission(w, r, requiredPermissionRead); !ok {
			return true
		}
		snapshot, err := g.layouts.Snapshot(r.Context())
		if err != nil {
			writeWorkbenchLayoutError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: snapshot})
		return true

	case r.Method == http.MethodGet && r.URL.Path == "/_redeven_proxy/api/workbench/layout/events":
		if _, ok := g.requirePermission(w, r, requiredPermissionRead); !ok {
			return true
		}
		g.handleWorkbenchLayoutEventStream(w, r)
		return true

	case r.Method == http.MethodPut && r.URL.Path == "/_redeven_proxy/api/workbench/layout":
		if _, ok := g.requirePermission(w, r, requiredPermissionWrite); !ok {
			return true
		}
		var body workbenchlayout.PutLayoutRequest
		if err := decodeWorkbenchLayoutJSON(r.Body, &body); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return true
		}
		snapshot, err := g.layouts.Replace(r.Context(), body)
		if err != nil {
			writeWorkbenchLayoutError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: snapshot})
		return true

	default:
		writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
		return true
	}
}

func writeWorkbenchLayoutError(w http.ResponseWriter, err error) {
	var validation *workbenchlayout.ValidationError
	if errors.As(err, &validation) {
		writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
		return
	}

	var conflict *workbenchlayout.RevisionConflictError
	if errors.As(err, &conflict) {
		writeJSON(w, http.StatusConflict, apiResp{
			OK:        false,
			Error:     "workbench layout revision conflict",
			ErrorCode: workbenchLayoutConflictErrorCode,
			Data: map[string]any{
				"current_revision": conflict.CurrentRevision,
			},
		})
		return
	}

	writeJSON(w, http.StatusInternalServerError, apiResp{OK: false, Error: err.Error()})
}

func decodeWorkbenchLayoutJSON(body io.Reader, out any) error {
	dec := json.NewDecoder(body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(out); err != nil {
		return err
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return errors.New("invalid json")
	}
	return nil
}

func (g *Gateway) handleWorkbenchLayoutEventStream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, apiResp{OK: false, Error: "streaming not supported"})
		return
	}

	afterSeq := int64(0)
	if raw := strings.TrimSpace(r.URL.Query().Get("after_seq")); raw != "" {
		value, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || value < 0 {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid after_seq"})
			return
		}
		afterSeq = value
	}

	baseline, ch, err := g.layouts.Subscribe(r.Context(), afterSeq)
	if err != nil {
		writeWorkbenchLayoutError(w, err)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Connection", "keep-alive")

	for _, event := range baseline {
		if err := writeWorkbenchLayoutSSEEvent(w, event); err != nil {
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
		case event, ok := <-ch:
			if !ok {
				return
			}
			if err := writeWorkbenchLayoutSSEEvent(w, event); err != nil {
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

func writeWorkbenchLayoutSSEEvent(w http.ResponseWriter, event workbenchlayout.Event) error {
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
