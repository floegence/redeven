package templatemarket

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	template "github.com/floegence/redeven-service-templates/template"
)

func marketItem(name string) Item {
	return Item{MarketTemplate: template.MarketTemplate{TemplateID: template.SourceIdentity(123, name), DocumentTemplateID: name, ServiceFamilyID: template.SourceIdentity(123, name), Revision: 1, Source: template.ResolvedSource{Repository: "owner/repo", RepositoryID: 123, Ref: "main", CommitSHA: strings.Repeat("a", 40)}, SHA256: strings.Repeat("b", 64), Deployment: "host", DefaultLocale: "en-US", Localizations: map[string]template.Localization{"en-US": {Name: name, Description: "A service"}}}, Classification: "community", Status: "available"}
}
func catalogPage(items []Item, generation int, next *string) any {
	return map[string]any{"data": items, "meta": map[string]any{"generation": generation, "stale": false, "next_cursor": next}}
}
func TestRefreshCommitsOnlyCompleteVerifiedGeneration(t *testing.T) {
	items := []Item{marketItem("a"), marketItem("b")}
	sort.Slice(items, func(i, j int) bool { return items[i].TemplateID < items[j].TemplateID })
	mode := "valid"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if mode == "invalid" {
			w.Write([]byte(`{}`))
			return
		}
		if mode == "offline" {
			w.WriteHeader(503)
			return
		}
		if mode == "missing-cursor" || mode == "missing-stale" || mode == "null-stale" {
			meta := map[string]any{"generation": 9, "stale": false, "next_cursor": nil}
			switch mode {
			case "missing-cursor":
				delete(meta, "next_cursor")
			case "missing-stale":
				delete(meta, "stale")
			case "null-stale":
				meta["stale"] = nil
			}
			json.NewEncoder(w).Encode(map[string]any{"data": items[:1], "meta": meta})
			return
		}
		generation := 9
		if mode == "regressed" {
			generation = 8
		}
		if r.URL.Query().Get("after") == "" {
			json.NewEncoder(w).Encode(catalogPage(items[:1], generation, &items[0].TemplateID))
			return
		}
		if r.URL.Query().Get("generation") != "9" && mode != "regressed" {
			t.Error("missing generation pin")
		}
		if mode == "changed" {
			generation++
		}
		if mode == "duplicate" {
			json.NewEncoder(w).Encode(catalogPage(items[:1], generation, nil))
			return
		}
		json.NewEncoder(w).Encode(catalogPage(items[1:], generation, nil))
	}))
	defer server.Close()
	s := Service{Origin: server.URL, Path: filepath.Join(t.TempDir(), "catalog.json")}
	result, err := s.Refresh(context.Background())
	if err != nil || len(result.Items) != 2 || result.Stale || result.Generation != 9 {
		t.Fatal(result, err)
	}
	original, _ := os.ReadFile(s.Path)
	for _, next := range []string{"invalid", "offline", "changed", "duplicate", "regressed", "missing-cursor", "missing-stale", "null-stale"} {
		mode = next
		result, err = s.Refresh(context.Background())
		if err == nil || !result.Stale || len(result.Items) != 2 {
			t.Fatalf("%s replaced verified cache: %+v %v", mode, result, err)
		}
		raw, _ := os.ReadFile(s.Path)
		if string(raw) != string(original) {
			t.Fatal("failed refresh changed durable cache")
		}
	}
	restarted := Service{Path: s.Path}
	if got := restarted.Cached(); !got.Stale || got.Generation != 9 || len(got.Items) != 2 {
		t.Fatal(got)
	}
}
func TestRefreshCancellationSingleflightAndRedirect(t *testing.T) {
	var calls atomic.Int32
	entered := make(chan struct{}, 1)
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		entered <- struct{}{}
		<-release
		json.NewEncoder(w).Encode(catalogPage([]Item{}, 1, nil))
	}))
	defer server.Close()
	s := Service{Origin: server.URL, Path: filepath.Join(t.TempDir(), "catalog.json")}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { _, err := s.Refresh(ctx); done <- err }()
	<-entered
	cancel()
	select {
	case err := <-done:
		if err != context.Canceled {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("cancellation did not return")
	}
	second := make(chan error, 1)
	go func() { _, err := s.Refresh(context.Background()); second <- err }()
	close(release)
	if err := <-second; err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 1 {
		t.Fatal("refresh was duplicated")
	}
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, server.URL, 302) }))
	defer redirect.Close()
	s.Origin = redirect.URL
	if _, err := s.Refresh(context.Background()); err == nil {
		t.Fatal("redirect accepted")
	}
}
func TestInvalidIdentityCannotEnterCache(t *testing.T) {
	for _, modify := range []func(*Item){func(i *Item) { i.TemplateID = template.SourceIdentity(999, "x") }, func(i *Item) { i.Source.Path = "../escape" }, func(i *Item) { i.Deployment = "script" }, func(i *Item) { i.Source.CommitSHA = "main" }, func(i *Item) { i.Localizations = nil }, func(i *Item) { i.Classification = "trusted" }} {
		item := marketItem("test")
		modify(&item)
		if Validate(item) == nil {
			t.Fatalf("invalid evidence accepted: %+v", item)
		}
	}
	s := Service{Path: filepath.Join(t.TempDir(), "cache")}
	os.WriteFile(s.Path, []byte(`{"items":[{}],"generation":1}`), 0600)
	if len(s.Cached().Items) != 0 {
		t.Fatal("invalid cache was used")
	}
}
