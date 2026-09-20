package ai

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/session"
)

func TestComputerEnvironmentSeparatesSetupPermissionsAndConnection(t *testing.T) {
	host, _, store, _ := computerBindingFixture(t)
	dir := t.TempDir()
	browser := NewPlaywrightTargetExecutor("/bin/sh", filepath.Join(dir, "browser.mjs"), filepath.Join(dir, "profiles"))
	if err := os.WriteFile(browser.HelperPath, []byte("exit 91\n"), 0600); err != nil {
		t.Fatal(err)
	}
	nativePath := filepath.Join(dir, "native.sh")
	native := NewNativeDesktopTargetExecutor(nativePath)
	host.executors["browser-main"], host.executors["desktop-main"] = browser, native
	service := &Service{targetToolExecutor: host, threadsDB: store}
	meta := &session.Meta{CanRead: true, CanWrite: true, CanExecute: true, EndpointID: "env"}
	for _, test := range []struct{ name, payload, state, reason string }{
		{"missing permission", `{"protocol_version":3,"screen_recording":false,"accessibility":true}`, "permission_required", "screen_recording_or_accessibility_missing"},
		{"ready", `{"protocol_version":3,"screen_recording":true,"accessibility":true}`, "ready", ""},
		{"incompatible helper", `{"protocol_version":1}`, "setup_required", "native_handshake_failed"},
	} {
		t.Run(test.name, func(t *testing.T) {
			script := "#!/bin/sh\n[ \"$1\" = --capabilities ] || exit 92\nprintf '%s\\n' '" + test.payload + "'\n"
			if err := os.WriteFile(nativePath, []byte(script), 0700); err != nil {
				t.Fatal(err)
			}
			result, err := service.ComputerEnvironment(t.Context(), meta)
			if err != nil || result.Desktop.State != test.state || result.Desktop.Reason != test.reason || result.Managed.State != "on_demand" || result.Hostname == "" || result.Platform == "" {
				t.Fatalf("capability: %+v %v", result, err)
			}
			if result.Chrome.Profiles == nil || len(result.Chrome.Profiles) != 0 {
				t.Fatalf("connection inventory: %+v", result.Chrome)
			}
			if native.cmd != nil || len(browser.clients) != 0 || len(host.managedProfiles) != 0 {
				t.Fatal("diagnostics started a control session")
			}
			if _, err := os.Stat(browser.ProfileDir); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("diagnostics created browser data: %v", err)
			}
			selected, err := store.GetComputerTarget(t.Context(), "thread-first")
			if err != nil || selected != "" {
				t.Fatalf("diagnostics changed selection: %q %v", selected, err)
			}
		})
	}
	if err := os.Remove(browser.HelperPath); err != nil {
		t.Fatal(err)
	}
	result, err := service.ComputerEnvironment(t.Context(), meta)
	if err != nil || result.Managed.State != "setup_required" || result.Managed.Reason != "browser_helper_missing" {
		t.Fatalf("missing component: %+v %v", result, err)
	}
	for _, denied := range []*session.Meta{nil, {CanRead: true}, {CanRead: true, CanWrite: true}} {
		if _, err := service.ComputerEnvironment(t.Context(), denied); err == nil {
			t.Fatal("unauthorized environment inspection")
		}
	}
	if err := host.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := service.ComputerEnvironment(t.Context(), meta); err == nil {
		t.Fatal("closed runtime reported availability")
	}
}

func TestComputerBrowserDiscoveryUsesScopedCandidatesWithoutBinding(t *testing.T) {
	host, _, store, _ := computerBindingFixture(t)
	dir := t.TempDir()
	browser := NewPlaywrightTargetExecutor("/bin/sh", filepath.Join(dir, "browser.mjs"), filepath.Join(dir, "profiles"))
	host.executors["browser-main"] = browser
	script := `[ "$2" = inventory ] || exit 91
printf '%s\n' '{"protocol_version":2,"tabs":[{"id":"page","profile_id":"work","title":"Unsaved draft","url":"https://example.test/draft"}]}'
`
	if err := os.WriteFile(filepath.Join(dir, "redevenBrowserInventory.mjs"), []byte(script), 0600); err != nil {
		t.Fatal(err)
	}
	service := &Service{targetToolExecutor: host, threadsDB: store}
	meta := &session.Meta{CanRead: true, CanWrite: true, CanExecute: true, EndpointID: "env"}
	endpoint := "http://127.0.0.1:9222"
	targetID := "known-page"
	attached := NewPlaywrightTargetExecutor("/bin/sh", browser.HelperPath, browser.ProfileDir)
	attached.CDPURL, attached.TabID, attached.BrowserContextID = endpoint, "page", "work"
	host.executors[targetID] = attached
	if err := store.SetComputerTarget(t.Context(), "thread-first", "original"); err != nil {
		t.Fatal(err)
	}
	// An already inventoried target must be enriched rather than duplicated.
	if err := host.registry.Register(TargetDescriptor{ID: targetID, Kind: "browser.connected", DisplayName: "Known page", Ready: true}); err != nil {
		t.Fatal(err)
	}
	control := host.controlForTarget(targetID)
	control.threadID = "thread-second"
	inventory, err := service.ComputerBrowserCandidates(t.Context(), meta, "thread-first", endpoint)
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, candidate := range inventory.Candidates {
		if candidate.TargetID != targetID {
			continue
		}
		count++
		if candidate.Title != "Unsaved draft" || candidate.State != "in_use" {
			t.Fatalf("discovered candidate: %+v", candidate)
		}
		captured, err := host.computerCandidate("thread-first", candidate.CandidateRef)
		if err != nil || captured.connection == nil || captured.connection.TabURL != "https://example.test/draft" || captured.connection.CDPURL != endpoint {
			t.Fatalf("identity snapshot: %+v %v", captured, err)
		}
		if _, err := host.computerCandidate("thread-second", candidate.CandidateRef); err == nil {
			t.Fatal("candidate escaped its thread")
		}
	}
	if count != 1 || inventory.CurrentTargetID != "original" {
		t.Fatalf("inventory duplicated or replaced selection: %+v", inventory)
	}
	selected, err := store.GetComputerTarget(t.Context(), "thread-first")
	if err != nil || selected != "original" || len(browser.clients) != 0 || len(host.managedProfiles) != 0 {
		t.Fatalf("discovery bound a page: %q %v", selected, err)
	}
	for _, endpoint := range []string{"file:///tmp/test", "http://user:secret@localhost:9222"} {
		if _, err := service.ComputerBrowserCandidates(t.Context(), meta, "thread-first", endpoint); err == nil {
			t.Fatal("unsafe endpoint accepted")
		}
	}
	for _, thread := range []string{"", "missing"} {
		if _, err := service.ComputerBrowserCandidates(t.Context(), meta, thread, endpoint); err == nil {
			t.Fatal("unknown thread accepted")
		}
	}
	other := *meta
	other.EndpointID = "other"
	if _, err := service.ComputerBrowserCandidates(t.Context(), &other, "thread-first", endpoint); err == nil {
		t.Fatal("cross-endpoint discovery accepted")
	}
	if _, err := host.computerBrowserCandidates(t.Context(), "thread-first", endpoint, ToolTargetPolicy{AllowedTargetIDs: []string{"browser-main"}}); err == nil {
		t.Fatal("discovery bypassed target restrictions")
	}
}

func TestComputerCandidateAppendRetainsInventoryBound(t *testing.T) {
	host, _, _, _ := computerBindingFixture(t)
	inventory := ComputerTargetInventory{Candidates: make([]ComputerCandidate, 1024)}
	if err := host.appendComputerCandidate(&inventory, "thread-first", ComputerCandidate{Kind: "browser.connected"}, nil); err == nil {
		t.Fatal("inventory bound exceeded")
	}
	if len(inventory.Candidates) != 1024 {
		t.Fatal("failed append changed inventory")
	}
}
