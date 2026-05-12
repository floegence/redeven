package gateway

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/terminal"
	"github.com/floegence/redeven/internal/workbenchlayout"
)

const (
	workbenchLayoutConflictErrorCode      = "WORKBENCH_LAYOUT_REVISION_CONFLICT"
	workbenchWidgetStateConflictErrorCode = "WORKBENCH_WIDGET_STATE_REVISION_CONFLICT"
	workbenchWidgetNotFoundErrorCode      = "WORKBENCH_WIDGET_NOT_FOUND"
	workbenchWidgetTypeMismatchErrorCode  = "WORKBENCH_WIDGET_TYPE_MISMATCH"
)

type workbenchTerminalSessionCreateRequest struct {
	Name       string `json:"name,omitempty"`
	WorkingDir string `json:"working_dir,omitempty"`
}

func (g *Gateway) handleWorkbenchLayoutAPI(w http.ResponseWriter, r *http.Request) bool {
	if r == nil || !strings.HasPrefix(strings.TrimSpace(r.URL.Path), "/_redeven_proxy/api/workbench/") {
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

	case r.Method == http.MethodPost && r.URL.Path == "/_redeven_proxy/api/workbench/actions/open_preview":
		if _, ok := g.requirePermission(w, r, requiredPermissionWrite); !ok {
			return true
		}
		var body workbenchlayout.OpenPreviewRequest
		if err := decodeWorkbenchLayoutJSON(r.Body, &body); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return true
		}
		resp, err := g.layouts.OpenPreview(r.Context(), body)
		if err != nil {
			writeWorkbenchLayoutError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: resp})
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

	case strings.HasPrefix(r.URL.Path, "/_redeven_proxy/api/workbench/widgets/"):
		return g.handleWorkbenchWidgetStateAPI(w, r)

	default:
		writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
		return true
	}
}

func (g *Gateway) handleWorkbenchWidgetStateAPI(w http.ResponseWriter, r *http.Request) bool {
	widgetID, tail, ok := parseWorkbenchWidgetPath(r.URL.Path)
	if !ok {
		writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
		return true
	}

	switch {
	case r.Method == http.MethodPut && tail == "state":
		if _, ok := g.requirePermission(w, r, requiredPermissionWrite); !ok {
			return true
		}
		var body workbenchlayout.PutWidgetStateRequest
		if err := decodeWorkbenchLayoutJSON(r.Body, &body); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return true
		}
		state, err := g.layouts.PutWidgetState(r.Context(), widgetID, body)
		if err != nil {
			writeWorkbenchLayoutError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: state})
		return true

	case r.Method == http.MethodPost && tail == "terminal/sessions":
		if _, ok := g.requirePermission(w, r, requiredPermissionFull); !ok {
			return true
		}
		if g.term == nil {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "terminal service not ready"})
			return true
		}
		var body workbenchTerminalSessionCreateRequest
		if err := decodeWorkbenchLayoutJSON(r.Body, &body); err != nil && !errors.Is(err, io.EOF) {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return true
		}
		session, err := g.term.CreateSession(strings.TrimSpace(body.Name), strings.TrimSpace(body.WorkingDir))
		if err != nil {
			writeWorkbenchLayoutError(w, err)
			return true
		}
		state, err := g.layouts.AppendTerminalSession(r.Context(), widgetID, session.ID)
		if err != nil {
			_ = g.term.DeleteSession(session.ID)
			writeWorkbenchLayoutError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{
			"session":      session,
			"widget_state": state,
		}})
		return true

	case r.Method == http.MethodDelete && strings.HasPrefix(tail, "terminal/sessions/"):
		if _, ok := g.requirePermission(w, r, requiredPermissionFull); !ok {
			return true
		}
		if g.term == nil {
			writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "terminal service not ready"})
			return true
		}
		sessionID := strings.TrimPrefix(tail, "terminal/sessions/")
		sessionID, err := url.PathUnescape(sessionID)
		if err != nil || strings.TrimSpace(sessionID) == "" {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid session id"})
			return true
		}
		state, err := g.layouts.RemoveTerminalSession(r.Context(), widgetID, sessionID)
		if err != nil {
			writeWorkbenchLayoutError(w, err)
			return true
		}
		if err := g.term.DeleteSessionForWidget(sessionID, widgetID); err != nil && !errors.Is(err, terminal.ErrSessionNotFound) {
			writeWorkbenchLayoutError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: state})
		return true

	default:
		writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
		return true
	}
}

func parseWorkbenchWidgetPath(path string) (widgetID string, tail string, ok bool) {
	const prefix = "/_redeven_proxy/api/workbench/widgets/"
	if !strings.HasPrefix(strings.TrimSpace(path), prefix) {
		return "", "", false
	}
	suffix := strings.TrimPrefix(path, prefix)
	parts := strings.Split(strings.Trim(suffix, "/"), "/")
	if len(parts) < 2 {
		return "", "", false
	}
	unescapedWidgetID, err := url.PathUnescape(parts[0])
	if err != nil || strings.TrimSpace(unescapedWidgetID) == "" {
		return "", "", false
	}
	return strings.TrimSpace(unescapedWidgetID), strings.Join(parts[1:], "/"), true
}

func writeWorkbenchLayoutError(w http.ResponseWriter, err error) {
	var validation *workbenchlayout.ValidationError
	if errors.As(err, &validation) {
		writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: err.Error()})
		return
	}

	var layoutConflict *workbenchlayout.RevisionConflictError
	if errors.As(err, &layoutConflict) {
		writeJSON(w, http.StatusConflict, apiResp{
			OK:        false,
			Error:     "workbench layout revision conflict",
			ErrorCode: workbenchLayoutConflictErrorCode,
			Data: map[string]any{
				"current_revision": layoutConflict.CurrentRevision,
			},
		})
		return
	}

	var widgetConflict *workbenchlayout.WidgetStateRevisionConflictError
	if errors.As(err, &widgetConflict) {
		writeJSON(w, http.StatusConflict, apiResp{
			OK:        false,
			Error:     "workbench widget state revision conflict",
			ErrorCode: workbenchWidgetStateConflictErrorCode,
			Data: map[string]any{
				"widget_id":        widgetConflict.WidgetID,
				"current_revision": widgetConflict.CurrentRevision,
			},
		})
		return
	}

	var widgetNotFound *workbenchlayout.WidgetNotFoundError
	if errors.As(err, &widgetNotFound) {
		writeJSON(w, http.StatusNotFound, apiResp{
			OK:        false,
			Error:     err.Error(),
			ErrorCode: workbenchWidgetNotFoundErrorCode,
		})
		return
	}

	var typeMismatch *workbenchlayout.WidgetTypeMismatchError
	if errors.As(err, &typeMismatch) {
		writeJSON(w, http.StatusConflict, apiResp{
			OK:        false,
			Error:     err.Error(),
			ErrorCode: workbenchWidgetTypeMismatchErrorCode,
			Data: map[string]any{
				"widget_id":     typeMismatch.WidgetID,
				"expected_type": typeMismatch.ExpectedType,
				"actual_type":   typeMismatch.ActualType,
			},
		})
		return
	}

	if errors.Is(err, terminal.ErrSessionNotFound) {
		writeJSON(w, http.StatusNotFound, apiResp{
			OK:        false,
			Error:     err.Error(),
			ErrorCode: "TERMINAL_SESSION_NOT_FOUND",
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
