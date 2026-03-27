package diagnostics

import (
	"path/filepath"
	"testing"
)

func TestStoreAppendListAndSnapshot(t *testing.T) {
	stateDir := t.TempDir()
	store, err := New(Options{StateDir: stateDir, Source: SourceAgent, MaxBytes: 512})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	store.Append(Event{Scope: ScopeLocalUIHTTP, Kind: "request", Method: "get", Path: "/api/local/runtime", StatusCode: 200, DurationMs: 35})
	store.Append(Event{Scope: ScopeGatewayAPI, Kind: "request", TraceID: "trace-1", Method: "post", Path: "/_redeven_proxy/api/settings", StatusCode: 500, DurationMs: 1250, Detail: map[string]any{"password": "secret", "reason": "failed"}})

	events, err := store.List(10)
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(events) != 2 {
		t.Fatalf("len(events) = %d, want 2", len(events))
	}
	if events[0].Source != SourceAgent {
		t.Fatalf("events[0].Source = %q, want %q", events[0].Source, SourceAgent)
	}
	if !events[0].Slow {
		t.Fatalf("events[0].Slow = false, want true")
	}
	if got := events[0].Detail["password"]; got != "[redacted]" {
		t.Fatalf("redacted password = %#v, want [redacted]", got)
	}
	snapshot := BuildSnapshot(10, 10, events)
	if snapshot.Stats.TotalEvents != 2 {
		t.Fatalf("snapshot total = %d, want 2", snapshot.Stats.TotalEvents)
	}
	if snapshot.Stats.SlowEvents != 1 {
		t.Fatalf("snapshot slow = %d, want 1", snapshot.Stats.SlowEvents)
	}
	if len(snapshot.SlowSummary) == 0 || snapshot.SlowSummary[0].Path != "/_redeven_proxy/api/settings" {
		t.Fatalf("unexpected slow summary = %#v", snapshot.SlowSummary)
	}
}

func TestListSourceReadsRotatedFiles(t *testing.T) {
	stateDir := t.TempDir()
	store, err := New(Options{StateDir: stateDir, Source: SourceDesktop, MaxBytes: 1})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	store.Append(Event{Scope: ScopeDesktopLifecycle, Kind: "startup", Message: "started"})
	store.Append(Event{Scope: ScopeDesktopHTTP, Kind: "completed", Path: "/_redeven_proxy/env/", StatusCode: 200, DurationMs: 20})
	files, err := listSourceFiles(stateDir, SourceDesktop)
	if err != nil {
		t.Fatalf("listSourceFiles() error = %v", err)
	}
	if len(files) < 2 {
		t.Fatalf("len(files) = %d, want at least 2", len(files))
	}
	if got := filepath.Base(files[0]); got != "desktop-events.jsonl" {
		t.Fatalf("active file = %q, want desktop-events.jsonl", got)
	}
	events, err := ListSource(stateDir, SourceDesktop, 10)
	if err != nil {
		t.Fatalf("ListSource() error = %v", err)
	}
	if len(events) != 2 {
		t.Fatalf("len(events) = %d, want 2", len(events))
	}
}

func TestStoreDisabledUntilEnabled(t *testing.T) {
	stateDir := t.TempDir()
	store, err := New(Options{StateDir: stateDir, Source: SourceAgent, Disabled: true})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	store.Append(Event{Scope: ScopeGatewayAPI, Kind: "request", Method: "GET", Path: "/_redeven_proxy/api/settings"})
	events, err := store.List(10)
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(events) != 0 {
		t.Fatalf("len(events) = %d, want 0 while disabled", len(events))
	}

	store.SetEnabled(true)
	if !store.Enabled() {
		t.Fatalf("Enabled() = false, want true after SetEnabled(true)")
	}
	store.Append(Event{Scope: ScopeGatewayAPI, Kind: "request", Method: "GET", Path: "/_redeven_proxy/api/settings"})

	events, err = store.List(10)
	if err != nil {
		t.Fatalf("List() after enable error = %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("len(events) = %d, want 1 after enabling", len(events))
	}

	store.SetEnabled(false)
	store.Append(Event{Scope: ScopeGatewayAPI, Kind: "request", Method: "POST", Path: "/_redeven_proxy/api/settings"})

	events, err = store.List(10)
	if err != nil {
		t.Fatalf("List() after disable error = %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("len(events) = %d, want 1 after disabling again", len(events))
	}
}
