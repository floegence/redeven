package appserver

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/managedwebservice"
	"github.com/floegence/redeven/internal/tessiven"
)

const tessivenAPIBase = "/_redeven_proxy/api/tessiven"

func (g *Server) handleTessivenAPI(w http.ResponseWriter, r *http.Request) bool {
	if r == nil || (r.URL.Path != tessivenAPIBase && !strings.HasPrefix(r.URL.Path, tessivenAPIBase+"/")) {
		return false
	}
	w.Header().Set("Cache-Control", "no-store")
	if g.tessiven == nil {
		writeJSON(w, 503, apiResp{OK: false, Error: "Tessiven is unavailable", ErrorCode: "TESSIVEN_UNAVAILABLE"})
		return true
	}
	path := strings.TrimPrefix(r.URL.Path, tessivenAPIBase)
	if !tessivenQueryAllowed(r.Method, path, r.URL.RawQuery) {
		writeTessivenError(w, tessiven.ErrInvalidRequest)
		return true
	}
	permission := requiredPermissionRead
	if r.Method != http.MethodGet && path != "/validate" && path != "/resources" {
		permission = requiredPermissionWrite
	}
	meta, ok := g.requirePermission(w, r, permission)
	if !ok {
		return true
	}
	if r.Method == http.MethodPost && path == "/resources" {
		var req tessiven.ResourceRequest
		if err := decodeTessivenJSON(r, &req); err != nil {
			writeTessivenError(w, err)
			return true
		}
		if g.tessivenResources == nil {
			writeTessivenError(w, tessiven.ErrTargetUnavailable)
			return true
		}
		result, err := g.tessivenResources.Execute(r.Context(), meta, req)
		writeTessivenResult(w, result, err)
		return true
	}
	if r.Method == http.MethodGet && path == "/schema" {
		writeJSON(w, 200, apiResp{OK: true, Data: tessiven.Schema()})
		return true
	}
	if r.Method == http.MethodGet && path == "/events" {
		g.handleTessivenEvents(w, r)
		return true
	}
	if r.Method == http.MethodPost && path == "/validate" {
		var req struct {
			DocumentYAML string `json:"document_yaml"`
		}
		if err := decodeTessivenJSON(r, &req); err != nil {
			writeTessivenError(w, err)
			return true
		}
		writeJSON(w, 200, apiResp{OK: true, Data: tessiven.Validate(req.DocumentYAML)})
		return true
	}
	if path == "/canvases" {
		switch r.Method {
		case http.MethodGet:
			q := r.URL.Query()
			if len(q.Get("query")) > 512 || len(q.Get("cursor")) > 128 {
				writeTessivenError(w, tessiven.ErrInvalidRequest)
				return true
			}
			result, err := g.tessiven.List(r.Context(), q.Get("query"), q.Get("cursor"), q.Get("archived") == "true")
			writeTessivenResult(w, result, err)
			return true
		case http.MethodPost:
			var req struct {
				RequestID string `json:"request_id"`
				Title     string `json:"title"`
			}
			if err := decodeTessivenJSON(r, &req); err != nil {
				writeTessivenError(w, err)
				return true
			}
			result, err := g.tessiven.Create(r.Context(), req.RequestID, req.Title)
			writeTessivenResult(w, result, err)
			return true
		}
	}
	parts := strings.Split(strings.TrimPrefix(path, "/"), "/")
	if len(parts) >= 2 && parts[0] == "canvases" && parts[1] != "" {
		id := parts[1]
		if len(parts) == 2 && r.Method == http.MethodGet {
			result, err := g.tessiven.Canvas(r.Context(), id)
			writeTessivenResult(w, result, err)
			return true
		}
		if len(parts) == 3 {
			switch parts[2] {
			case "flower-thread":
				if r.Method == http.MethodPost {
					var req struct {
						ThreadID string `json:"thread_id"`
					}
					if err := decodeTessivenJSON(r, &req); err != nil {
						writeTessivenError(w, err)
						return true
					}
					err := g.tessiven.BindFlowerThread(r.Context(), id, req.ThreadID)
					writeTessivenResult(w, map[string]string{"thread_id": strings.TrimSpace(req.ThreadID)}, err)
					return true
				}
			case "versions":
				if r.Method == http.MethodGet {
					before, err := parseTessivenVersion(r.URL.Query().Get("before"), true)
					if err != nil {
						writeTessivenError(w, err)
						return true
					}
					result, err := g.tessiven.Versions(r.Context(), id, before)
					writeTessivenResult(w, result, err)
					return true
				}
			case "archive":
				if r.Method == http.MethodPost {
					var req struct {
						ExpectedVersion int64 `json:"expected_version"`
						Archived        bool  `json:"archived"`
					}
					if err := decodeTessivenJSON(r, &req); err != nil {
						writeTessivenError(w, err)
						return true
					}
					err := g.tessiven.Archive(r.Context(), id, req.ExpectedVersion, req.Archived)
					writeTessivenResult(w, map[string]bool{"archived": req.Archived}, err)
					return true
				}
			}
		}
		if len(parts) == 4 && parts[2] == "versions" && r.Method == http.MethodGet {
			var version int64
			var err error
			if parts[3] != "latest" {
				version, err = parseTessivenVersion(parts[3], false)
			}
			if err != nil {
				writeTessivenError(w, err)
				return true
			}
			result, err := g.tessiven.Version(r.Context(), id, version)
			writeTessivenResult(w, result, err)
			return true
		}
	}
	writeJSON(w, 404, apiResp{OK: false, Error: "Tessiven route not found", ErrorCode: "TESSIVEN_NOT_FOUND"})
	return true
}

func parseTessivenVersion(raw string, optional bool) (int64, error) {
	if raw == "" && optional {
		return 0, nil
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value <= 0 {
		return 0, tessiven.ErrInvalidRequest
	}
	return value, nil
}
func decodeTessivenJSON(r *http.Request, out any) error {
	defer r.Body.Close()
	decoder := json.NewDecoder(io.LimitReader(r.Body, tessiven.MaxDocumentBytes+65537))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return fmt.Errorf("%w: %s", tessiven.ErrInvalidRequest, err)
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return tessiven.ErrInvalidRequest
	}
	return nil
}
func writeTessivenResult(w http.ResponseWriter, result any, err error) {
	if err != nil {
		writeTessivenError(w, err)
		return
	}
	writeJSON(w, 200, apiResp{OK: true, Data: result})
}
func writeTessivenError(w http.ResponseWriter, err error) {
	status, code := 500, "TESSIVEN_INTERNAL"
	message := "Tessiven could not complete the request"
	var data any
	var validation *tessiven.ValidationError
	var resource *tessiven.ResourceError
	var managed *managedwebservice.Error
	switch {
	case errors.As(err, &resource), errors.As(err, &managed):
		status, code, message = tessiven.ResourceErrorDetails(err)
	case errors.Is(err, tessiven.ErrOutcomeUnknown):
		status, code, message = 409, "TESSIVEN_OUTCOME_UNKNOWN", err.Error()
	case errors.Is(err, tessiven.ErrPermissionDenied):
		status, code, message = 403, "TESSIVEN_PERMISSION_DENIED", err.Error()
	case errors.Is(err, tessiven.ErrTargetUnavailable), errors.Is(err, tessiven.ErrOperationUnavailable):
		status, code, message = 409, "TESSIVEN_RESOURCE_UNAVAILABLE", err.Error()
	case errors.Is(err, tessiven.ErrResourceChanged), errors.Is(err, tessiven.ErrHistoricalOperation):
		status, code, message = 409, "TESSIVEN_RESOURCE_CONFLICT", err.Error()
	case errors.As(err, &validation):
		status, code, message, data = 422, "TESSIVEN_VALIDATION", err.Error(), validation
	case errors.Is(err, tessiven.ErrNotFound):
		status, code, message = 404, "TESSIVEN_NOT_FOUND", err.Error()
	case errors.Is(err, tessiven.ErrConflict):
		status, code, message = 409, "TESSIVEN_VERSION_CONFLICT", err.Error()
	case errors.Is(err, tessiven.ErrRequestConflict):
		status, code, message = 409, "TESSIVEN_REQUEST_CONFLICT", err.Error()
	case errors.Is(err, tessiven.ErrArchived):
		status, code, message = 409, "TESSIVEN_ARCHIVED", err.Error()
	case errors.Is(err, tessiven.ErrInvalidRequest):
		status, code, message = 400, "TESSIVEN_INVALID_REQUEST", err.Error()
	}
	writeJSON(w, status, apiResp{OK: false, Error: message, ErrorCode: code, Data: data})
}
func (g *Server) handleTessivenEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeTessivenError(w, errors.New("stream unavailable"))
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	changes, unsubscribe := g.tessiven.Subscribe()
	defer unsubscribe()
	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()
	write := func(frame string) bool {
		_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(10 * time.Second))
		if _, err := io.WriteString(w, frame); err != nil {
			return false
		}
		flusher.Flush()
		return true
	}
	for {
		select {
		case <-r.Context().Done():
			return
		case _, open := <-changes:
			if !open || !write("event: changed\ndata: {}\n\n") {
				return
			}
		case <-ticker.C:
			if !write(": keepalive\n\n") {
				return
			}
		}
	}
}

func tessivenQueryAllowed(method, path, raw string) bool {
	values, err := url.ParseQuery(raw)
	if err != nil {
		return false
	}
	for key, list := range values {
		if method != http.MethodGet || len(list) != 1 {
			return false
		}
		if path == "/canvases" {
			switch key {
			case "query":
				if len(list[0]) > 512 {
					return false
				}
			case "cursor":
				if len(list[0]) > 128 {
					return false
				}
			case "archived":
				if list[0] != "true" && list[0] != "false" {
					return false
				}
			default:
				return false
			}
		} else if strings.HasSuffix(path, "/versions") && key == "before" {
			if _, err := parseTessivenVersion(list[0], false); err != nil {
				return false
			}
		} else {
			return false
		}
	}
	return true
}
