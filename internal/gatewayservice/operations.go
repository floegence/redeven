package gatewayservice

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"

	"github.com/floegence/redeven/internal/gatewaystate"
)

const OperationIDHeader = "X-Redeven-Operation-ID"

var operationIDPattern = regexp.MustCompile("^[a-zA-Z0-9_-]{16,128}$")

type hostOperation struct {
	Fingerprint string
	State       string
	Status      int
	Body        json.RawMessage
	ExpiresAt   int64
}
type hostOperations struct {
	mu      sync.Mutex
	path    string
	records map[string]hostOperation
}

func loadHostOperations(root string) (*hostOperations, error) {
	journal := &hostOperations{path: filepath.Join(root, "host-operations.json"), records: map[string]hostOperation{}}
	if err := gatewaystate.Read(journal.path, &journal.records); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if journal.records == nil || len(journal.records) > 1024 {
		return nil, gatewaystate.ErrState
	}
	for id, record := range journal.records {
		if !operationIDPattern.MatchString(id) || len(record.Fingerprint) != 64 || record.ExpiresAt <= 0 || (record.State != "running" && record.State != "completed" && record.State != "unknown") || (record.State == "completed" && (record.Status < 200 || record.Status > 599 || !json.Valid(record.Body))) {
			return nil, gatewaystate.ErrState
		}
		if record.State == "running" {
			record.State = "unknown"
			journal.records[id] = record
		}
	}
	return journal, nil
}
func hostMutation(path string) bool {
	switch path {
	case "/gateway/v6/clients/access-codes", "/gateway/v6/clients/revoke", "/gateway/v6/invitation-codes", "/gateway/v6/endpoints", "/gateway/v6/network-settings", "/gateway/v6/attachments/remove", "/gateway/v6/attachments/reevaluate", "/gateway/v6/attachments/policy", "/gateway/v6/policy":
		return true
	}
	return false
}

// A durable intent precedes the effect. Interrupted effects are never replayed.
func (s *Server) hostOperationHandler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Path == "/gateway/v6/operations/query"
		if !query && !hostMutation(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}
		if !s.isHostAdminRequest(r) {
			next.ServeHTTP(w, r)
			return
		}
		if r.Method != http.MethodPost {
			writeError(w, 405, "METHOD_NOT_ALLOWED")
			return
		}
		id := r.Header.Get(OperationIDHeader)
		if !operationIDPattern.MatchString(id) {
			writeError(w, 400, "OPERATION_ID_REQUIRED")
			return
		}
		w.Header().Set(OperationIDHeader, id)
		journal := s.operations
		journal.mu.Lock()
		record, exists := journal.records[id]
		if query {
			journal.mu.Unlock()
			if _, ok := s.authenticated(w, r, new(map[string]any)); !ok {
				return
			}
			if !exists || record.ExpiresAt <= time.Now().UnixMilli() {
				writeError(w, 404, "OPERATION_NOT_FOUND")
				return
			}
			if record.State != "completed" {
				writeError(w, 409, "OPERATION_RESULT_UNKNOWN")
				return
			}
			writeOperation(w, record)
			return
		}
		raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64<<10))
		if err != nil {
			journal.mu.Unlock()
			writeError(w, 400, "INVALID_REQUEST")
			return
		}
		digest := sha256.Sum256(append([]byte(r.Method+"\n"+r.URL.Path+"\n"), raw...))
		fingerprint := hex.EncodeToString(digest[:])
		if exists {
			journal.mu.Unlock()
			r.Body = io.NopCloser(bytes.NewReader(raw))
			if _, ok := s.authenticated(w, r, new(map[string]any)); !ok {
				return
			}
			if record.Fingerprint != fingerprint {
				writeError(w, 409, "OPERATION_ID_CONFLICT")
				return
			}
			if record.State != "completed" {
				writeError(w, 409, "OPERATION_RESULT_UNKNOWN")
				return
			}
			writeOperation(w, record)
			return
		}
		now := time.Now()
		for key, value := range journal.records {
			if value.ExpiresAt <= now.UnixMilli() {
				delete(journal.records, key)
			}
		}
		if len(journal.records) >= 1024 {
			journal.mu.Unlock()
			writeError(w, 429, "OPERATION_CAPACITY")
			return
		}
		record = hostOperation{Fingerprint: fingerprint, State: "running", ExpiresAt: now.Add(24 * time.Hour).UnixMilli()}
		journal.records[id] = record
		if err := gatewaystate.Write(journal.path, journal.records); err != nil {
			delete(journal.records, id)
			journal.mu.Unlock()
			writeError(w, 503, "OPERATION_STORAGE_UNAVAILABLE")
			return
		}
		journal.mu.Unlock()
		r.Body = io.NopCloser(bytes.NewReader(raw))
		response := &operationResponse{header: make(http.Header)}
		next.ServeHTTP(response, r)
		record.Status = response.status
		if record.Status == 0 {
			record.Status = 200
		}
		record.Body = response.body.Bytes()
		record.State = "completed"
		journal.mu.Lock()
		journal.records[id] = record
		if err := gatewaystate.Write(journal.path, journal.records); err != nil {
			record.State = "unknown"
			record.Body = nil
			record.Status = 0
			journal.records[id] = record
			journal.mu.Unlock()
			writeError(w, 503, "OPERATION_RESULT_UNKNOWN")
			return
		}
		journal.mu.Unlock()
		writeOperation(w, record)
	})
}

type operationResponse struct {
	header http.Header
	status int
	body   bytes.Buffer
}

func (r *operationResponse) Header() http.Header { return r.header }
func (r *operationResponse) WriteHeader(status int) {
	if r.status == 0 {
		r.status = status
	}
}
func (r *operationResponse) Write(raw []byte) (int, error) { return r.body.Write(raw) }
func writeOperation(w http.ResponseWriter, record hostOperation) {
	w.Header().Set("X-Redeven-Operation-State", "completed")
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(record.Status)
	_, _ = w.Write(record.Body)
}
