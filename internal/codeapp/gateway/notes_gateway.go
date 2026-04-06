package gateway

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/notes"
)

func (g *Gateway) handleNotesAPI(w http.ResponseWriter, r *http.Request) bool {
	if r == nil || !strings.HasPrefix(strings.TrimSpace(r.URL.Path), "/_redeven_proxy/api/notes") {
		return false
	}
	if g == nil || g.notes == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiResp{OK: false, Error: "notes service not ready"})
		return true
	}

	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/_redeven_proxy/api/notes/snapshot":
		if _, ok := g.requirePermission(w, r, requiredPermissionRead); !ok {
			return true
		}
		snapshot, err := g.notes.Snapshot(r.Context())
		if err != nil {
			writeNotesError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: snapshot})
		return true

	case r.Method == http.MethodGet && r.URL.Path == "/_redeven_proxy/api/notes/events":
		if _, ok := g.requirePermission(w, r, requiredPermissionRead); !ok {
			return true
		}
		g.handleNotesEventStream(w, r)
		return true

	case r.Method == http.MethodPost && r.URL.Path == "/_redeven_proxy/api/notes/topics":
		if _, ok := g.requirePermission(w, r, requiredPermissionWrite); !ok {
			return true
		}
		var body notes.CreateTopicRequest
		if err := decodeNotesJSON(r.Body, &body); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return true
		}
		topic, err := g.notes.CreateTopic(r.Context(), body)
		if err != nil {
			writeNotesError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"topic": topic}})
		return true

	case strings.HasPrefix(r.URL.Path, "/_redeven_proxy/api/notes/topics/"):
		if _, ok := g.requirePermission(w, r, requiredPermissionWrite); !ok {
			return true
		}
		rest := strings.TrimPrefix(r.URL.Path, "/_redeven_proxy/api/notes/topics/")
		topicID, ok := singlePathSegment(rest)
		if !ok {
			writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
			return true
		}
		switch r.Method {
		case http.MethodPatch:
			var body notes.UpdateTopicRequest
			if err := decodeNotesJSON(r.Body, &body); err != nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
				return true
			}
			body.TopicID = topicID
			topic, err := g.notes.UpdateTopic(r.Context(), body)
			if err != nil {
				writeNotesError(w, err)
				return true
			}
			writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"topic": topic}})
			return true
		case http.MethodDelete:
			if err := g.notes.DeleteTopic(r.Context(), topicID); err != nil {
				writeNotesError(w, err)
				return true
			}
			writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"topic_id": topicID}})
			return true
		default:
			writeJSON(w, http.StatusMethodNotAllowed, apiResp{OK: false, Error: "method not allowed"})
			return true
		}

	case r.Method == http.MethodPost && r.URL.Path == "/_redeven_proxy/api/notes/items":
		if _, ok := g.requirePermission(w, r, requiredPermissionWrite); !ok {
			return true
		}
		var body notes.CreateItemRequest
		if err := decodeNotesJSON(r.Body, &body); err != nil {
			writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
			return true
		}
		item, err := g.notes.CreateItem(r.Context(), body)
		if err != nil {
			writeNotesError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"item": item}})
		return true

	case strings.HasPrefix(r.URL.Path, "/_redeven_proxy/api/notes/items/"):
		if _, ok := g.requirePermission(w, r, requiredPermissionWrite); !ok {
			return true
		}
		rest := strings.TrimPrefix(r.URL.Path, "/_redeven_proxy/api/notes/items/")
		noteID, tail := headPathSegment(rest)
		if strings.TrimSpace(noteID) == "" {
			writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
			return true
		}
		switch {
		case r.Method == http.MethodPatch && tail == "":
			var body notes.UpdateItemRequest
			if err := decodeNotesJSON(r.Body, &body); err != nil {
				writeJSON(w, http.StatusBadRequest, apiResp{OK: false, Error: "invalid json"})
				return true
			}
			body.NoteID = noteID
			item, err := g.notes.UpdateItem(r.Context(), body)
			if err != nil {
				writeNotesError(w, err)
				return true
			}
			writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"item": item}})
			return true
		case r.Method == http.MethodDelete && tail == "":
			if err := g.notes.DeleteItem(r.Context(), noteID); err != nil {
				writeNotesError(w, err)
				return true
			}
			writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"note_id": noteID}})
			return true
		case r.Method == http.MethodPost && tail == "front":
			item, err := g.notes.BringItemToFront(r.Context(), noteID)
			if err != nil {
				writeNotesError(w, err)
				return true
			}
			writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"item": item}})
			return true
		case r.Method == http.MethodPost && tail == "restore":
			item, err := g.notes.RestoreItem(r.Context(), noteID)
			if err != nil {
				writeNotesError(w, err)
				return true
			}
			writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"item": item}})
			return true
		default:
			writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
			return true
		}

	case r.Method == http.MethodDelete && strings.HasPrefix(r.URL.Path, "/_redeven_proxy/api/notes/trash/topics/"):
		if _, ok := g.requirePermission(w, r, requiredPermissionWrite); !ok {
			return true
		}
		rest := strings.TrimPrefix(r.URL.Path, "/_redeven_proxy/api/notes/trash/topics/")
		topicID, ok := singlePathSegment(rest)
		if !ok {
			writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
			return true
		}
		if err := g.notes.ClearTrashTopic(r.Context(), topicID); err != nil {
			writeNotesError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"topic_id": topicID}})
		return true
	case r.Method == http.MethodDelete && strings.HasPrefix(r.URL.Path, "/_redeven_proxy/api/notes/trash/items/"):
		if _, ok := g.requirePermission(w, r, requiredPermissionWrite); !ok {
			return true
		}
		rest := strings.TrimPrefix(r.URL.Path, "/_redeven_proxy/api/notes/trash/items/")
		noteID, ok := singlePathSegment(rest)
		if !ok {
			writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
			return true
		}
		if err := g.notes.DeleteTrashedItemPermanently(r.Context(), noteID); err != nil {
			writeNotesError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, apiResp{OK: true, Data: map[string]any{"note_id": noteID}})
		return true
	default:
		writeJSON(w, http.StatusNotFound, apiResp{OK: false, Error: "not found"})
		return true
	}
}

func writeNotesError(w http.ResponseWriter, err error) {
	var status int
	switch {
	case err == nil:
		status = http.StatusOK
	case errors.Is(err, notes.ErrTopicNotFound), errors.Is(err, notes.ErrNoteNotFound):
		status = http.StatusNotFound
	case errors.Is(err, notes.ErrInvalidTopicID), errors.Is(err, notes.ErrInvalidNoteID), errors.Is(err, notes.ErrInvalidTopicName), errors.Is(err, notes.ErrInvalidNoteBody), errors.Is(err, notes.ErrInvalidColor):
		status = http.StatusBadRequest
	default:
		status = http.StatusBadRequest
	}
	writeJSON(w, status, apiResp{OK: false, Error: err.Error()})
}

func decodeNotesJSON(body io.Reader, out any) error {
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

func (g *Gateway) handleNotesEventStream(w http.ResponseWriter, r *http.Request) {
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
	baseline, ch, err := g.notes.Subscribe(r.Context(), afterSeq)
	if err != nil {
		writeNotesError(w, err)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Connection", "keep-alive")

	for _, event := range baseline {
		if err := writeNotesSSEEvent(w, event); err != nil {
			return
		}
	}
	flusher.Flush()

	keepAlive := time.NewTicker(20 * time.Second)
	defer keepAlive.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-keepAlive.C:
			if _, err := io.WriteString(w, ": keepalive\n\n"); err != nil {
				return
			}
			flusher.Flush()
		case event, ok := <-ch:
			if !ok {
				return
			}
			if err := writeNotesSSEEvent(w, event); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func writeNotesSSEEvent(w io.Writer, event notes.Event) error {
	body, err := json.Marshal(event)
	if err != nil {
		return err
	}
	if _, err := io.WriteString(w, "event: notes_event\n"); err != nil {
		return err
	}
	if _, err := io.WriteString(w, "data: "); err != nil {
		return err
	}
	if _, err := w.Write(body); err != nil {
		return err
	}
	_, err = io.WriteString(w, "\n\n")
	return err
}

func singlePathSegment(value string) (string, bool) {
	value = strings.Trim(strings.TrimSpace(value), "/")
	if value == "" || strings.Contains(value, "/") {
		return "", false
	}
	return value, true
}

func headPathSegment(value string) (string, string) {
	value = strings.Trim(strings.TrimSpace(value), "/")
	if value == "" {
		return "", ""
	}
	parts := strings.Split(value, "/")
	if len(parts) == 1 {
		return parts[0], ""
	}
	return parts[0], strings.Join(parts[1:], "/")
}
