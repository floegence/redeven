package ai

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/floegence/floret/v7/identity"
	"github.com/floegence/floret/v7/observation"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/storage"
)

func TestFlowerReleasedUnknownHostWorkContract(t *testing.T) {
	root := filepath.Join("testdata", "host-work-v7.102.0")
	raw, err := os.ReadFile(filepath.Join(root, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct{ Files map[string]string }
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	for name, want := range manifest.Files {
		raw, err := os.ReadFile(filepath.Join(root, name))
		if err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(raw)
		if hex.EncodeToString(sum[:]) != want {
			t.Fatalf("fixture changed: %s", name)
		}
	}
	raw, err = os.ReadFile(filepath.Join(root, "history.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "history.sqlite")
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		host, err := flruntime.Open(t.Context(), flruntime.Options{Storage: storage.SQLite(path), DeferExecution: true})
		if err != nil {
			t.Fatal(err)
		}
		service, err := host.ThreadService(flruntime.AgentFactoryFunc(func(context.Context, flruntime.AgentRequest) (*flruntime.Agent, error) {
			t.Error("historical read executed provider preparation")
			return nil, fmt.Errorf("unexpected execution")
		}))
		if err != nil {
			t.Fatal(err)
		}
		view, err := service.View(t.Context(), identity.ThreadID("unknown-host-work"))
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, item := range view.Items {
			if item.Activity == nil || item.Activity.ToolID != "shell-1" {
				continue
			}
			found = true
			public := projectFlowerActivity(*item.Activity)
			if public.Status != observation.ActivityStatusUnknown || !public.NeedsAttention || public.Presentation == nil {
				t.Fatalf("lost public unknown: %+v", public)
			}
			raw, err := json.MarshalIndent(public, "", "  ")
			if err != nil {
				t.Fatal(err)
			}

			want, err := os.ReadFile(filepath.Join(root, "activity.json"))
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(bytes.TrimSpace(raw), bytes.TrimSpace(want)) {
				t.Fatal("published Activity DTO changed")
			}
		}
		if !found {
			t.Fatal("unknown historical activity missing")
		}
		if err := host.Shutdown(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
}
