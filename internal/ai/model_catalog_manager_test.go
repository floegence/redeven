package ai

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/config"
)

func TestCatalogSnapshotSurvivesFailureRestartAndRemoval(t *testing.T) {
	p := config.AIProvider{ID: "local", Type: "ollama", BaseURL: "http://localhost:11434/v1", ModelSelection: &config.AIModelSelection{SelectedModels: []string{"agent"}}}
	cfg := &config.AIConfig{Providers: []config.AIProvider{p}, CurrentModelID: "local/agent"}
	root := filepath.Join(t.TempDir(), "runtime", "model-catalog")
	m := newModelCatalogManager(root, nil, nil, nil)
	m.configure(cfg)
	m.discover = func(context.Context, ModelCatalogRequest) (ModelCatalogResponse, error) {
		return ModelCatalogResponse{Models: []ModelCatalogModel{{AIProviderModel: config.AIProviderModel{ModelName: "agent", ContextWindow: 8192, MaxOutputTokens: 1024}}}}, nil
	}
	if _, err := m.sync(context.Background(), providerCatalogRequest(p, "")); err != nil {
		t.Fatal(err)
	}
	if !m.resolve(cfg).IsAllowedModelID("local/agent") {
		t.Fatal("successful inventory not published")
	}
	m.discover = func(context.Context, ModelCatalogRequest) (ModelCatalogResponse, error) {
		return ModelCatalogResponse{}, errors.New("offline")
	}
	if _, err := m.sync(context.Background(), providerCatalogRequest(p, "")); err == nil {
		t.Fatal("missing manual error")
	}
	restarted := newModelCatalogManager(root, nil, nil, nil)
	restarted.configure(cfg)
	if !restarted.resolve(cfg).IsAllowedModelID("local/agent") {
		t.Fatal("offline restart lost metadata")
	}
	restarted.discover = func(context.Context, ModelCatalogRequest) (ModelCatalogResponse, error) {
		return ModelCatalogResponse{Models: []ModelCatalogModel{}}, nil
	}
	if _, err := restarted.sync(context.Background(), providerCatalogRequest(p, "")); err != nil {
		t.Fatal(err)
	}
	if restarted.resolve(cfg).IsAllowedModelID("local/agent") || cfg.CurrentModelID != "local/agent" {
		t.Fatal("complete empty inventory did not preserve unavailable selection")
	}
}

func TestCatalogReadsDoNotWaitAndLateConnectionCannotPublish(t *testing.T) {
	p := config.AIProvider{ID: "p", Type: "deepseek", BaseURL: "https://api.deepseek.com", ModelSelection: &config.AIModelSelection{SelectedModels: []string{"deepseek-flash"}}}
	cfg := &config.AIConfig{Providers: []config.AIProvider{p}, CurrentModelID: "p/deepseek-flash"}
	m := newModelCatalogManager(t.TempDir(), nil, nil, nil)
	m.configure(cfg)
	started, release := make(chan struct{}), make(chan struct{})
	m.discover = func(context.Context, ModelCatalogRequest) (ModelCatalogResponse, error) {
		close(started)
		<-release
		return ModelCatalogResponse{Models: []ModelCatalogModel{}}, nil
	}
	done := make(chan error, 1)
	go func() { _, err := m.sync(context.Background(), providerCatalogRequest(p, "")); done <- err }()
	<-started
	read := make(chan bool, 1)
	go func() { read <- m.resolve(cfg).IsAllowedModelID(cfg.CurrentModelID) }()
	select {
	case ready := <-read:
		if !ready {
			t.Fatal("shipped model blocked")
		}
	case <-time.After(time.Second):
		t.Fatal("snapshot read waited for supplier")
	}
	next := *cfg
	next.Providers = []config.AIProvider{p}
	next.Providers[0].BaseURL = "https://other.example/v1"
	m.configure(&next)
	close(release)
	if err := <-done; err == nil {
		t.Fatal("stale connection response accepted")
	}
	if !m.resolve(&next).IsAllowedModelID(cfg.CurrentModelID) {
		t.Fatal("old response poisoned new scope")
	}
}

func syncConfiguredCatalogForTest(t *testing.T, svc *Service, p config.AIProvider) {
	t.Helper()
	if _, err := svc.DiscoverModelCatalog(t.Context(), providerCatalogRequest(p, "")); err != nil {
		t.Fatal(err)
	}
}

func TestCatalogWriteFailureRetainsSelectionAndRecovery(t *testing.T) {
	p := config.AIProvider{ID: "p", Type: "openai", ModelSelection: &config.AIModelSelection{SelectedModels: []string{"gpt-5-mini"}}}
	cfg := &config.AIConfig{Providers: []config.AIProvider{p}, CurrentModelID: "p/gpt-5-mini"}
	root := t.TempDir()
	inventory := []ModelCatalogModel{{AIProviderModel: config.AIProviderModel{ModelName: "gpt-5-mini", ContextWindow: 8192, MaxOutputTokens: 1024}}}
	changes := 0
	m := newModelCatalogManager(root, nil, func(context.Context, ModelCatalogRequest) (ModelCatalogResponse, error) {
		return ModelCatalogResponse{Models: inventory}, nil
	}, func() { changes++ })
	m.configure(cfg)
	syncCatalog := func(wantError bool) {
		t.Helper()
		_, err := m.sync(t.Context(), providerCatalogRequest(p, ""))
		if (err != nil) != wantError {
			t.Fatalf("sync: %v", err)
		}
	}
	syncCatalog(false)
	inventory = []ModelCatalogModel{}
	// A path whose parent is a file deterministically rejects cache writes, even as root.
	block := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(block, []byte("blocked"), 0600); err != nil {
		t.Fatal(err)
	}
	m.root = filepath.Join(block, "catalog")
	syncCatalog(true)
	if !m.resolve(cfg).IsAllowedModelID(cfg.CurrentModelID) || changes != 1 {
		t.Fatal("failed disk publication replaced metadata")
	}
	m.root = root
	syncCatalog(false)
	if m.resolve(cfg).IsAllowedModelID(cfg.CurrentModelID) || cfg.CurrentModelID != "p/gpt-5-mini" {
		t.Fatal("removed selection changed")
	}
	inventory = []ModelCatalogModel{{AIProviderModel: config.AIProviderModel{ModelName: "gpt-5-mini", ContextWindow: 16384, MaxOutputTokens: 2048}}, {AIProviderModel: config.AIProviderModel{ModelName: "new-model", ContextWindow: 8192}}}
	syncCatalog(false)
	resolved := m.resolve(cfg)
	_, model, ok := resolved.ProviderModelByID(cfg.CurrentModelID)
	reviewed, _ := config.AIModelCatalogEntry(p.Type, "gpt-5-mini")
	if !ok || model.ContextWindow != reviewed.ContextWindow || resolved.IsAllowedModelID("p/new-model") {
		t.Fatal("reappearance or new-model selection violated intent")
	}
}

func TestCatalogDraftSyncSurvivesSaveAndCredentialRotation(t *testing.T) {
	p := config.AIProvider{ID: "p", Type: "ollama", BaseURL: "http://localhost/v1", ModelSelection: &config.AIModelSelection{SelectedModels: []string{"agent"}}}
	key := "first"
	m := newModelCatalogManager(t.TempDir(), func(string) (string, bool, error) { return key, true, nil }, func(context.Context, ModelCatalogRequest) (ModelCatalogResponse, error) {
		return ModelCatalogResponse{Models: []ModelCatalogModel{{AIProviderModel: config.AIProviderModel{ModelName: "agent", ContextWindow: 8192}}}}, nil
	}, nil)
	if _, err := m.sync(t.Context(), providerCatalogRequest(p, key)); err != nil {
		t.Fatal(err)
	}
	cfg := &config.AIConfig{Providers: []config.AIProvider{p}, CurrentModelID: "p/agent"}
	m.configure(cfg)
	if !m.resolve(cfg).IsAllowedModelID(cfg.CurrentModelID) {
		t.Fatal("draft sync was not available after save")
	}
	key = "another-account"
	m.configure(cfg)
	if m.resolve(cfg).IsAllowedModelID(cfg.CurrentModelID) {
		t.Fatal("credential scope reused inventory")
	}
	key = "first"
	m.configure(cfg)
	if !m.resolve(cfg).IsAllowedModelID(cfg.CurrentModelID) {
		t.Fatal("returning scope lost inventory")
	}
}

func TestCatalogSingleFlightConcurrencyAndQueueCancellation(t *testing.T) {
	started := make(chan string, 8)
	release := make(chan struct{})
	var calls atomic.Int32
	m := newModelCatalogManager(t.TempDir(), nil, func(ctx context.Context, in ModelCatalogRequest) (ModelCatalogResponse, error) {
		calls.Add(1)
		started <- in.ProviderID
		select {
		case <-release:
			return ModelCatalogResponse{Models: []ModelCatalogModel{}}, nil
		case <-ctx.Done():
			return ModelCatalogResponse{}, ctx.Err()
		}
	}, nil)
	done := make(chan error, 8)
	for i := 0; i < 4; i++ {
		go func(i int) {
			_, err := m.sync(t.Context(), ModelCatalogRequest{ProviderID: fmt.Sprint(i), Type: "openai"})
			done <- err
		}(i)
	}
	for i := 0; i < 4; i++ {
		select {
		case <-started:
		case <-time.After(time.Second):
			t.Fatal("worker did not start")
		}
	}
	go func() {
		_, err := m.sync(t.Context(), ModelCatalogRequest{ProviderID: "0", Type: "openai"})
		done <- err
	}()
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Millisecond)
	defer cancel()
	if _, err := m.sync(ctx, ModelCatalogRequest{ProviderID: "queued", Type: "openai"}); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("queue deadline: %v", err)
	}
	if calls.Load() != 4 {
		t.Fatal("exceeded concurrency bound or duplicated provider request")
	}
	close(release)
	for i := 0; i < 5; i++ {
		if err := <-done; err != nil {
			t.Fatal(err)
		}
	}
}
