package appserver

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/automation"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redevplugin/v3/pkg/schedule"
)

func TestAutomationRoutesBindOwnerAndExplicitGrant(t *testing.T) {
	store, err := automation.Open(filepath.Join(t.TempDir(), "automation.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	plans, err := schedule.Open(filepath.Join(t.TempDir(), "schedules.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer plans.Close()
	meta := session.Meta{EndpointID: "env", UserPublicID: "user", NamespacePublicID: "namespace", FloeApp: "app", CanRead: true, CanWrite: true, CanExecute: true}
	server := &Server{automation: store, resolveSessionMeta: func(id string) (*session.Meta, bool) {
		copy := meta
		copy.ChannelID = id
		return &copy, id == "automation-channel"
	}}
	server.automationSchedules = &automation.Schedules{Store: store, Plans: plans, Authorize: func(ctx context.Context, o automation.Owner, r automation.Run) error {
		g, err := store.GrantVersion(ctx, o, r.WorkflowID, r.DefinitionVersion)
		if err != nil || !g.Enabled {
			return automation.ErrUnauthorized
		}
		return nil
	}}
	call := func(method, path string, body any) *httptest.ResponseRecorder {
		t.Helper()
		raw, _ := json.Marshal(body)
		request := httptest.NewRequest(method, automationAPI+path, strings.NewReader(string(raw)))
		request.Header.Set("Origin", envOriginWithChannel("automation-channel"))
		response := httptest.NewRecorder()
		if !server.handleAutomationAPI(response, request) {
			t.Fatal("route missing")
		}
		return response
	}
	definition := automation.Definition{Title: "Report", Goal: "Render a report", Nodes: []automation.Node{{ID: "render", Title: "Render", Kind: "render", Template: "<h1>{{.Title}}</h1>"}}, MaxConcurrent: 1, TimeoutSeconds: 30}
	response := call("POST", "/workflows", map[string]any{"request_id": "create", "definition": definition})
	if response.Code != 200 {
		t.Fatal(response.Code, response.Body.String())
	}
	var env struct {
		Data automation.Workflow `json:"data"`
	}
	if err = json.Unmarshal(response.Body.Bytes(), &env); err != nil {
		t.Fatal(err)
	}
	flow := env.Data
	if _, err := store.Grant(t.Context(), automation.Owner{User: "user", Environment: "env"}, flow.ID); err == nil {
		t.Fatal("draft granted execution")
	}
	meta.CanWrite = false
	if got := call("POST", "/workflows/"+flow.ID+"/publish", map[string]any{}); got.Code != 403 {
		t.Fatal(got.Code)
	}
	meta.CanWrite = true
	req := map[string]any{"revision": flow.Revision, "tools": []string{}, "expires_at": time.Now().Add(time.Hour)}
	response = call("POST", "/workflows/"+flow.ID+"/publish", req)
	if response.Code != 200 {
		t.Fatal(response.Code, response.Body.String())
	}
	if got := call("POST", "/workflows/"+flow.ID+"/publish", req); got.Code != 409 {
		t.Fatal("stale publish accepted", got.Code)
	}
	grant, err := store.Grant(t.Context(), automation.Owner{User: "user", Environment: "env"}, flow.ID)
	if err != nil || grant.Authority.Namespace != "namespace" || grant.Authority.App != "app" {
		t.Fatal(grant, err)
	}
	for _, field := range []*string{&meta.UserPublicID, &meta.EndpointID} {
		old := *field
		*field = "foreign"
		if got := call("GET", "/workflows/"+flow.ID, nil); got.Code != 404 {
			t.Fatal("foreign read", got.Code)
		}
		*field = old
	}
	runRequest := map[string]any{"request_id": "once", "version": 1, "purpose": "test", "scheduled_at": time.Now()}
	response = call("POST", "/workflows/"+flow.ID+"/run", runRequest)
	if response.Code != 200 {
		t.Fatal(response.Code, response.Body.String())
	}
	originalReceipt := response.Body.String()
	cadence := map[string]any{"kind": "interval", "interval_ms": 3600000}
	if got := call("POST", "/workflows/"+flow.ID+"/schedule-preview", map[string]any{"cadence": cadence}); got.Code != 200 {
		t.Fatal(got.Code, got.Body.String())
	}
	if current, err := server.automationSchedules.Get(t.Context(), automation.Owner{User: "user", Environment: "env"}, flow.ID); err != nil || current != nil {
		t.Fatal("preview created plan", current, err)
	}
	if got := call("POST", "/workflows/"+flow.ID+"/schedule", map[string]any{"revision": 0, "version": 1, "enabled": true, "cadence": cadence, "overlap": "skip", "missed": "latest", "queue_limit": 1}); got.Code != 200 {
		t.Fatal(got.Code, got.Body.String())
	}
	definition.Goal = "Unpublished changes"
	if got := call("POST", "/workflows/"+flow.ID+"/save", map[string]any{"revision": 2, "definition": definition}); got.Code != 200 {
		t.Fatal(got.Code, got.Body.String())
	}
	if got := call("POST", "/workflows/"+flow.ID+"/schedule-pause", map[string]any{}); got.Code != 200 {
		t.Fatal(got.Code, got.Body.String())
	}
	if paused, err := server.automationSchedules.Get(t.Context(), automation.Owner{User: "user", Environment: "env"}, flow.ID); err != nil || paused == nil || paused.Enabled || paused.Version != 1 {
		t.Fatal("pause did not retain pinned publication", paused, err)
	}
	if got := call("POST", "/workflows/"+flow.ID+"/revoke", map[string]any{}); got.Code != 200 {
		t.Fatal(got.Code)
	}
	response = call("POST", "/workflows/"+flow.ID+"/run", runRequest)
	if response.Code != 200 || response.Body.String() != originalReceipt {
		t.Fatal("lost admitted receipt after revoke", response.Code, response.Body.String())
	}
	runRequest["purpose"] = "live"
	if got := call("POST", "/workflows/"+flow.ID+"/run", runRequest); got.Code != 409 {
		t.Fatal("mutated receipt accepted", got.Code)
	}
	runRequest["request_id"] = "new-after-revoke"
	if got := call("POST", "/workflows/"+flow.ID+"/run", runRequest); got.Code != 403 {
		t.Fatal("new run after revoke", got.Code)
	}
	if got := call(http.MethodPost, "/workflows", map[string]any{"owner": "spoofed", "request_id": "other", "definition": definition}); got.Code != 400 {
		t.Fatal("spoofed identity accepted", got.Code)
	}
}
