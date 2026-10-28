package environmentcenter

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"sync"
	"time"
)

type mutationResult struct {
	mu               sync.Mutex
	session, request string
	expires          time.Time
	status           int
	body             []byte
	retryAfter       string
}
type mutationWriter struct {
	header http.Header
	bytes.Buffer
	status int
}

func (w *mutationWriter) Header() http.Header { return w.header }
func (w *mutationWriter) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
	}
}
func (w *mutationWriter) Write(raw []byte) (int, error) {
	if w.status == 0 {
		w.status = 200
	}
	return w.Buffer.Write(raw)
}

// One exact authenticated request owns a grant's result. A lost response is
// recovered without repeating upstream pairing or state mutation. Restart
// invalidates the owning session, so these records must not resurrect it.
func (s *Server) mutation(w http.ResponseWriter, r *http.Request) {
	route := r.URL.Path
	switch route {
	case "/api/center/v1/routes/rotate", "/api/center/v1/gateways/begin", "/api/center/v1/routes/add", "/api/center/v1/bookmarks/add", "/api/center/v1/sources/remove", "/api/center/v1/factor/replace", "/api/center/v1/recovery/rotate", "/api/center/v1/password":
	default:
		s.api(w, r)
		return
	}
	if r.Method != "POST" {
		s.api(w, r)
		return
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64<<10))
	if err != nil {
		writeJSON(w, nil, ErrDenied)
		return
	}
	var envelope struct {
		Grant string `json:"grant"`
	}
	if json.Unmarshal(raw, &envelope) != nil || envelope.Grant == "" {
		writeJSON(w, nil, ErrDenied)
		return
	}
	token := cookieValue(r, sessionCookie)
	if _, err = s.center.Session(token); err != nil {
		writeJSON(w, nil, err)
		return
	}
	key := digest(envelope.Grant)
	request := digest(route + ":" + string(raw))
	s.mu.Lock()
	for k, v := range s.mutations {
		if !time.Now().Before(v.expires) {
			delete(s.mutations, k)
		}
	}
	result := s.mutations[key]
	if result == nil {
		if len(s.mutations) >= 128 {
			s.mu.Unlock()
			writeJSON(w, nil, ErrBusy)
			return
		}
		result = &mutationResult{session: token, request: request, expires: time.Now().Add(GrantLifetime)}
		s.mutations[key] = result
	}
	s.mu.Unlock()
	result.mu.Lock()
	defer result.mu.Unlock()
	if result.session != token || result.request != request {
		writeJSON(w, nil, ErrDenied)
		return
	}
	if result.status == 0 {
		r.Body = io.NopCloser(bytes.NewReader(raw))
		recorder := &mutationWriter{header: make(http.Header)}
		s.api(recorder, r)
		result.status = recorder.status
		if result.status == 0 {
			result.status = 200
		}
		result.body = append([]byte(nil), recorder.Bytes()...)
		result.retryAfter = recorder.Header().Get("Retry-After")
	}
	w.Header().Set("Content-Type", "application/json")
	if result.retryAfter != "" {
		w.Header().Set("Retry-After", result.retryAfter)
	}
	w.WriteHeader(result.status)
	_, _ = w.Write(result.body)
}
