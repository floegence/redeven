package appserver

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/plugincreation"
	"github.com/floegence/redeven/internal/session"
)

type draftRouteAuthor struct{ creates int }

func (b *draftRouteAuthor) CreateWorkspace(_ context.Context, _ *session.Meta, request string) (string, error) {
	b.creates++
	return "workspace_" + request, nil
}
func (*draftRouteAuthor) SourceScope(context.Context, *session.Meta, string) (plugincreation.SourceScope, error) {
	return plugincreation.SourceScope{}, nil
}
func (*draftRouteAuthor) RemoveWorkspace(context.Context, *session.Meta, string) error { return nil }
func (*draftRouteAuthor) AuthorOperation(context.Context, *session.Meta, string, string, map[string]any) (any, error) {
	return nil, nil
}

func TestPluginDraftRoutesBindOwnerAndRecoverRequests(t *testing.T) {
	store, err := plugincreation.Open(filepath.Join(t.TempDir(), "drafts.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	service := plugincreation.New(store)
	backend := &draftRouteAuthor{}
	service.SetBackend(backend)
	const channel = "draft-route-channel"
	meta := session.Meta{UserPublicID: "author", EndpointID: "environment", CanRead: true, CanWrite: true, CanExecute: true}
	server := &Server{pluginCreation: service, resolveSessionMeta: func(id string) (*session.Meta, bool) {
		copy := meta
		copy.ChannelID = id
		return &copy, id == channel
	}}
	call := func(method, route, body string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, pluginCreationAPI+route, strings.NewReader(body))
		req.Header.Set("Origin", envOriginWithChannel(channel))
		response := httptest.NewRecorder()
		if !server.handlePluginCreationAPI(response, req) {
			t.Fatal("draft route was not handled")
		}
		if response.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("draft state must not be cached")
		}
		return response
	}
	decode := func(response *httptest.ResponseRecorder) plugincreation.Draft {
		t.Helper()
		if response.Code != http.StatusOK {
			t.Fatalf("HTTP %d: %s", response.Code, response.Body.String())
		}
		var envelope struct {
			Data plugincreation.Draft `json:"data"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
			t.Fatal(err)
		}
		return envelope.Data
	}
	for _, body := range []string{`{"request_id":"create","owner_user":"foreign"}`, `{"request_id":"create"} {}`, `{`} {
		if response := call(http.MethodPost, "/drafts", body); response.Code != http.StatusBadRequest {
			t.Fatalf("invalid request accepted: %d %s", response.Code, response.Body.String())
		}
	}
	meta.CanWrite = false
	if response := call(http.MethodPost, "/drafts", `{"request_id":"create"}`); response.Code != http.StatusForbidden || backend.creates != 0 {
		t.Fatal("read-only session reached author mutation")
	}
	meta.CanWrite = true
	draft := decode(call(http.MethodPost, "/drafts", `{"request_id":"create"}`))
	retried := decode(call(http.MethodPost, "/drafts", `{"request_id":"create"}`))
	if draft.ID == "" || draft.WorkspaceID == "" || retried != draft || backend.creates != 1 {
		t.Fatalf("retry created a second workspace: %+v %+v calls=%d", draft, retried, backend.creates)
	}
	rename, _ := json.Marshal(map[string]any{"revision": draft.Revision, "title": "Focus timer"})
	renamed := decode(call(http.MethodPost, "/drafts/"+draft.ID+"/rename", string(rename)))
	if renamed.Title != "Focus timer" || renamed.Revision != draft.Revision+1 {
		t.Fatalf("rename: %+v", renamed)
	}
	if response := call(http.MethodPost, "/drafts/"+draft.ID+"/rename", string(rename)); response.Code != http.StatusConflict {
		t.Fatal("stale tab overwrote current draft")
	}
	for _, field := range []*string{&meta.UserPublicID, &meta.EndpointID} {
		original := *field
		*field = "foreign"
		if response := call(http.MethodGet, "/drafts/"+draft.ID, ""); response.Code != http.StatusNotFound {
			t.Fatalf("foreign owner read draft: %d %s", response.Code, response.Body.String())
		}
		if response := call(http.MethodGet, "/drafts", ""); response.Code != http.StatusOK || strings.Contains(response.Body.String(), draft.ID) {
			t.Fatal("foreign inventory leaked draft")
		}
		*field = original
	}
	meta.CanRead = false
	if response := call(http.MethodGet, "/drafts", ""); response.Code != http.StatusForbidden {
		t.Fatal("missing read permission exposed draft inventory")
	}
}
