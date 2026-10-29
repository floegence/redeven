package appserver

import (
	"encoding/json"
	"fmt"
	"net/http"
	"reflect"
	"strings"
	"testing"

	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/session"
)

func TestServerFlowerHistoryAcceptsCompleteReadingSelection(t *testing.T) {
	state := t.TempDir()
	options := ai.Options{StateDir: state, AgentHomeDir: state, Shell: "/bin/sh", Config: appserverTestAIConfig(), DeferExecution: true}
	service, err := ai.NewService(options)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = service.Close() })
	meta := session.Meta{EndpointID: "history", NamespacePublicID: "history", UserPublicID: "reader", CanRead: true, CanWrite: true, CanExecute: true}
	thread, err := service.CreateThread(t.Context(), &meta, "History request size", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := service.Close(); err != nil {
		t.Fatal(err)
	}
	// Published writers produce long canonical identities after retries. Their
	// finite reading membership must fit even though it exceeds a body locator.
	for index := range 76 {
		turn := fmt.Sprintf("retry-turn-%s-%03d", strings.Repeat("a", 64), index)
		seedFloretThreadTurn(t, state, thread.ThreadID, turn, "run-"+turn, fmt.Sprintf("Question %d", index), fmt.Sprintf("Answer %d", index))
	}
	service, err = ai.NewService(options)
	if err != nil {
		t.Fatal(err)
	}
	server, origin := newAIReadinessTestServer(t, newStaticAIServiceProvider(service), meta)
	defer server.Close()
	path := "/_redeven_proxy/api/ai/threads/" + thread.ThreadID + "/history"
	type response struct {
		Data struct {
			Current flruntime.ThreadView   `json:"current"`
			Window  ai.FlowerHistoryWindow `json:"window"`
		} `json:"data"`
	}
	read := func(input ai.FlowerHistoryRequest) response {
		t.Helper()
		body, err := json.Marshal(input)
		if err != nil {
			t.Fatal(err)
		}
		rr := performServerRequest(server, http.MethodPost, path, origin, string(body))
		if rr.Code != http.StatusOK {
			t.Fatalf("history request bytes=%d status=%d body=%s", len(body), rr.Code, rr.Body.String())
		}
		var value response
		if err := json.Unmarshal(rr.Body.Bytes(), &value); err != nil {
			t.Fatal(err)
		}
		return value
	}
	page := read(ai.FlowerHistoryRequest{Limit: 150})
	if len(page.Data.Current.Items) != 150 || !page.Data.Window.HasBefore {
		t.Fatal("fixture must exceed one reading window")
	}
	ids := make([]string, len(page.Data.Current.Items))
	for i, item := range page.Data.Current.Items {
		ids[i] = item.ID
	}
	body, _ := json.Marshal(ai.FlowerHistoryRequest{ItemIDs: ids})
	if len(body) <= 8<<10 {
		t.Fatalf("fixture request only has %d bytes", len(body))
	}
	selected := read(ai.FlowerHistoryRequest{ItemIDs: ids})
	if !reflect.DeepEqual(selected.Data.Current.Items, page.Data.Current.Items) {
		t.Fatal("selection changed canonical contents or order")
	}
	pageBody, _ := json.Marshal(map[string]any{"ancestor_leaf_id": page.Data.Window.LeafID, "anchor_id": ids[0], "direction": "before", "limit": 40})
	rr := performServerRequest(server, http.MethodPost, path+"-page", origin, string(pageBody))
	if rr.Code != http.StatusOK {
		t.Fatalf("page status=%d body=%s", rr.Code, rr.Body.String())
	}
	var canonical struct {
		Data flruntime.ThreadItemPage `json:"data"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &canonical); err != nil {
		t.Fatal(err)
	}
	if len(canonical.Data.Items) != 2 || canonical.Data.ThreadID.String() != thread.ThreadID || canonical.Data.HasBefore {
		t.Fatal("invalid canonical page")
	}
	for _, invalid := range []string{`{"unknown":true}`, `{} {}`, `{"thread_id":"another"}`, `{"limit":151}`, `{"ancestor_leaf_id":"missing"}`} {
		if response := performServerRequest(server, http.MethodPost, path+"-page", origin, invalid); response.Code == http.StatusOK {
			t.Fatalf("invalid page accepted: %s", invalid)
		}
	}
	// Child reads use the same membership budget before validating the parent
	// relationship. A root cannot be read as its own child, regardless of size.
	childPath := "/_redeven_proxy/api/ai/threads/" + thread.ThreadID + "/subagents/" + thread.ThreadID + "/detail"
	child := performServerRequest(server, http.MethodPost, childPath, origin, string(body))
	if child.Code != http.StatusNotFound || strings.Contains(child.Body.String(), "invalid history request") {
		t.Fatalf("child membership rejected before relationship validation: %d %s", child.Code, child.Body.String())
	}
	older := read(ai.FlowerHistoryRequest{AnchorID: ids[0], Direction: flruntime.ThreadWindowBefore, Limit: 40})
	if len(older.Data.Current.Items) != 2 || older.Data.Window.HasBefore {
		t.Fatal("older records are unreachable")
	}
	for _, invalid := range []string{`{"unknown":true}`, `{} {}`, strings.Repeat(" ", 64<<10) + `{}`, `null`} {
		rr := performServerRequest(server, http.MethodPost, path, origin, invalid)
		if rr.Code != http.StatusBadRequest {
			t.Fatalf("invalid history bytes=%d status=%d", len(invalid), rr.Code)
		}
		child := performServerRequest(server, http.MethodPost, childPath, origin, invalid)
		if child.Code != http.StatusBadRequest || !strings.Contains(child.Body.String(), "invalid history request") {
			t.Fatalf("invalid child history bytes=%d status=%d", len(invalid), child.Code)
		}
	}
	tooMany, _ := json.Marshal(ai.FlowerHistoryRequest{ItemIDs: append(ids, older.Data.Current.Items[0].ID)})
	if rr := performServerRequest(server, http.MethodPost, path, origin, string(tooMany)); rr.Code != http.StatusBadRequest {
		t.Fatalf("unbounded selection status=%d", rr.Code)
	}
	for _, suffix := range []string{"-item", "-body"} {
		rr := performServerRequest(server, http.MethodPost, path+suffix, origin, strings.Repeat(" ", 8<<10)+`{"item_id":"item"}`)
		if rr.Code != http.StatusBadRequest {
			t.Fatalf("body request bound changed: %s status=%d", suffix, rr.Code)
		}
	}
}
