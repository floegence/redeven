package codeapp

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/automation"
	"github.com/floegence/redeven/internal/config"
)

func TestAutomationFixedToolsReauthorizeAndDoNotRedirect(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "config.json")
	cfg := &config.Config{LocalEnvironmentPublicID: "env", PermissionPolicy: &config.PermissionPolicy{SchemaVersion: 1, LocalMax: &config.PermissionSet{Read: true, Write: true, Execute: true}}}
	if err := config.Save(path, cfg); err != nil {
		t.Fatal(err)
	}
	store, err := automation.Open(filepath.Join(root, "automation.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	owner := automation.Owner{User: "user", Environment: "env"}
	var reads atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reads.Add(1)
		if r.Header.Get("Cookie") != "" || r.Header.Get("Authorization") != "" {
			t.Error("ambient credentials")
		}
		if r.URL.Path == "/redirect" {
			http.Redirect(w, r, "/secret", 302)
			return
		}
		if r.URL.Path == "/large" {
			w.Write([]byte(strings.Repeat("x", 49153)))
			return
		}
		w.Write([]byte("observed fact"))
	}))
	defer target.Close()
	params, _ := json.Marshal(map[string]string{"url": target.URL + "/redirect"})
	definition := automation.Definition{Title: "News fetch", Goal: "Read bounded source", MaxConcurrent: 1, TimeoutSeconds: 30, Nodes: []automation.Node{{ID: "fetch", Title: "Fetch", Kind: "tool", Tool: "http_get", Parameters: params}}}
	w, err := store.Create(t.Context(), owner, "source", definition)
	if err != nil {
		t.Fatal(err)
	}
	p, err := store.Publish(t.Context(), owner, w.ID, w.Revision, automation.Grant{Enabled: true, Authority: automation.GrantAuthority{Namespace: "namespace", App: "app", Read: true, Write: true, Execute: true}, ExpiresAt: time.Now().Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	run, err := store.CreateRun(t.Context(), owner, w.ID, "read", p.Version, "test", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	principal, err := automationAuthority(store, path)(t.Context(), owner, run)
	if err != nil || principal == nil || principal.ChannelID != "" || principal.SessionKind != "automation" || principal.CanAdmin || principal.UserPublicID != owner.User || principal.EndpointID != owner.Environment {
		t.Fatalf("invalid background delegation: %v", err)
	}
	executor := &automationExecutor{store: store, configPath: path}
	data, err := executor.Tool(t.Context(), owner, run, automation.Attempt{}, definition.Nodes[0])
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), `"status":302`) || reads.Load() != 1 {
		t.Fatal("redirect followed", string(data), reads.Load())
	}
	params, _ = json.Marshal(map[string]string{"url": target.URL + "/large"})
	node := definition.Nodes[0]
	node.Parameters = params
	if _, err := executor.Tool(t.Context(), owner, run, automation.Attempt{}, node); err == nil {
		t.Fatal("oversized result accepted")
	}
	cfg.PermissionPolicy.LocalMax.Execute = false
	if err := config.Save(path, cfg); err != nil {
		t.Fatal(err)
	}
	if _, err := executor.Tool(context.Background(), owner, run, automation.Attempt{}, node); !errors.Is(err, automation.ErrUnauthorized) {
		t.Fatal("changed policy ignored", err)
	}
	if reads.Load() != 2 {
		t.Fatal("revoked request reached source")
	}
}
