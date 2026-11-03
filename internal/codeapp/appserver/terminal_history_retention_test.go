package appserver

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"

	termgo "github.com/floegence/floeterm/terminal-go"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/sessionrpc"
	"github.com/floegence/redeven/internal/terminal"
)

type retentionManagerStub struct {
	workbenchTerminalSessionManager
	defaults termgo.HistoryRetentionLimits
	applied  int
}

func (s *retentionManagerStub) HistoryRetentionAvailable() bool { return true }
func (s *retentionManagerStub) SetHistoryRetentionDefaults(l termgo.HistoryRetentionLimits) error {
	s.defaults = l.Clone()
	return nil
}
func (s *retentionManagerStub) SessionHistoryRetention(m *session.Meta, id, connection string, generation uint64, l *termgo.HistoryRetentionLimits) (termgo.HistoryRetentionState, error) {
	if !m.CanWrite || !m.CanExecute {
		return termgo.HistoryRetentionState{}, &sessionrpc.Error{Code: 403, Message: "denied"}
	}
	if id != "session" {
		return termgo.HistoryRetentionState{}, terminal.ErrSessionNotFound
	}
	if l != nil {
		if connection != "view" || generation != 7 {
			return termgo.HistoryRetentionState{}, &sessionrpc.Error{Code: 409, Message: "attachment changed"}
		}
		s.applied++
	}
	return termgo.HistoryRetentionState{Configured: s.defaults, Effective: s.defaults}, nil
}
func TestTerminalHistoryRetentionSettingsPersistencePermissionsAndExplicitApply(t *testing.T) {
	path := writeTestConfig(t)
	meta := session.Meta{CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true}
	manager := &retentionManagerStub{}
	srv, err := New(Options{Backend: &stubBackend{}, DistFS: fstest.MapFS{"env/index.html": {Data: []byte("<html>env</html>")}}, ConfigPath: path, ResolveSessionMeta: func(string) (*session.Meta, bool) { copy := meta; return &copy, true }})
	if err != nil {
		t.Fatal(err)
	}
	srv.term = manager
	request := func(method, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "/_redeven_proxy/api/terminal/history-retention", bytes.NewBufferString(body))
		r.Header.Set("Origin", envOriginWithChannel("retention"))
		w := httptest.NewRecorder()
		srv.serveHTTP(w, r)
		return w
	}
	for _, body := range []string{`{"limits":{"max_lines":-1,"max_bytes":null}}`, `{"limits":{"max_lines":1.5,"max_bytes":null}}`, `{"limits":{"max_lines":9007199254740992,"max_bytes":null}}`, `{"limits":{"max_lines":1,"max_bytes":null,"unknown":1}}`, `{"limits":null}`, `{"limits":{}} {}`} {
		if got := request(http.MethodPut, body); got.Code != 400 {
			t.Fatalf("invalid %s: %d %s", body, got.Code, got.Body.String())
		}
	}
	meta.CanRead = false
	if got := request(http.MethodGet, ""); got.Code != 403 {
		t.Fatalf("read permission=%d", got.Code)
	}
	meta.CanRead = true
	if got := request(http.MethodDelete, ""); got.Code != 405 {
		t.Fatalf("method=%d", got.Code)
	}
	meta.CanAdmin = false
	if got := request(http.MethodPut, `{"limits":{"max_lines":100,"max_bytes":0}}`); got.Code != 403 {
		t.Fatalf("nonadmin=%d", got.Code)
	}
	meta.CanAdmin = true
	if got := request(http.MethodPut, `{"limits":{"max_lines":100,"max_bytes":0}}`); got.Code != 200 {
		t.Fatalf("save=%d %s", got.Code, got.Body.String())
	}
	if manager.applied != 0 || manager.defaults.MaxLines == nil || *manager.defaults.MaxLines != 100 || *manager.defaults.MaxBytes != 0 {
		t.Fatal("defaults changed sessions or lost zero")
	}
	cfg, err := config.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.TerminalHistoryRetention.MaxLines == nil || *cfg.TerminalHistoryRetention.MaxLines != 100 {
		t.Fatal("defaults did not persist")
	}
	stale := *cfg
	stale.TerminalHistoryRetention = termgo.HistoryRetentionLimits{}
	if err := config.SaveConnection(path, &stale); err != nil {
		t.Fatal(err)
	}
	cfg, err = config.Load(path)
	if err != nil || cfg.TerminalHistoryRetention.MaxLines == nil {
		t.Fatal("connection refresh erased retention")
	}
	got := request(http.MethodGet, "")
	if got.Code != 200 {
		t.Fatal(got.Body.String())
	}
	var response struct {
		Data struct {
			Defaults termgo.HistoryRetentionLimits `json:"defaults"`
		} `json:"data"`
	}
	if err := json.Unmarshal(got.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if !(*response.Data.Defaults.MaxLines == 100) {
		t.Fatal("read lost saved value")
	}
	meta.CanAdmin = false
	body := `{"session_id":"session","connection_id":"view","transport_generation":7,"limits":{"max_lines":null,"max_bytes":null}}`
	if got := request(http.MethodPost, body); got.Code != 200 || manager.applied != 1 {
		t.Fatalf("apply=%d %s", got.Code, got.Body.String())
	}
	meta.CanExecute = false
	if got := request(http.MethodPost, body); got.Code != 403 || manager.applied != 1 {
		t.Fatal("unauthorized apply")
	}
	meta.CanExecute = true
	if got := request(http.MethodPost, `{"session_id":"session","connection_id":"view","transport_generation":6,"limits":{}}`); got.Code != 409 || manager.applied != 1 {
		t.Fatal("stale apply")
	}
	meta.CanAdmin = true
	if got := request(http.MethodPut, `{"limits":{"max_lines":null,"max_bytes":null}}`); got.Code != 200 || manager.defaults.MaxBytes != nil || manager.defaults.MaxLines != nil {
		t.Fatal("reset defaults")
	}
}
