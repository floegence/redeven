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

func TestModelCatalogSchedulerRequiresExplicitOptIn(t *testing.T) {
	p := config.AIProvider{ID: "local", Type: "ollama", BaseURL: "http://localhost:11434/v1", Models: []config.AIProviderModel{{ModelName: "agent", ContextWindow: 8192}}}
	called := make(chan struct{}, 1)
	published := make(chan struct{}, 1)
	m := newModelCatalogManager(t.TempDir(), nil, func(context.Context, ModelCatalogRequest) (ModelCatalogResponse, error) {
		called <- struct{}{}
		return ModelCatalogResponse{Models: []ModelCatalogModel{{AIProviderModel: config.AIProviderModel{ModelName: "agent", ContextWindow: 8192}}}}, nil
	}, func() { published <- struct{}{} })
	cfg := &config.AIConfig{Providers: []config.AIProvider{p}}
	m.configure(cfg)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() { m.run(ctx); close(done) }()
	defer func() { cancel(); <-done }()
	select {
	case <-called:
		t.Fatal("scheduler contacted provider while automatic updates were disabled")
	case <-time.After(100 * time.Millisecond):
	}
	enabled := true
	cfg.AutoUpdateModelCatalog = &enabled
	m.configure(cfg)
	select {
	case <-called:
	case <-time.After(time.Second):
		t.Fatal("scheduler did not contact provider after automatic updates were enabled")
	}
	select {
	case <-published:
	case <-time.After(time.Second):
		t.Fatal("scheduler did not publish the completed inventory")
	}
	enabled = false
	m.configure(cfg)
	m.mu.Lock()
	connection := m.connections[p.ID]
	connection.next = time.Time{}
	m.connections[p.ID] = connection
	m.mu.Unlock()
	m.wake()
	select {
	case <-called:
		t.Fatal("scheduler contacted provider after automatic updates were disabled")
	case <-time.After(100 * time.Millisecond):
	}
	if _, err := m.sync(ctx, providerCatalogRequest(p, "")); err != nil {
		t.Fatalf("manual synchronization with automatic updates disabled: %v", err)
	}
	select {
	case <-called:
	default:
		t.Fatal("manual synchronization did not contact provider")
	}
}

func TestModelCatalogSchedulerExcludesOpenRouterButAllowsExplicitDiscovery(t *testing.T) {
	openrouter := config.AIProvider{ID: "router", Type: "openrouter"}
	ollama := config.AIProvider{ID: "local", Type: "ollama"}
	called := make(chan string, 4)
	m := newModelCatalogManager(t.TempDir(), nil, func(_ context.Context, in ModelCatalogRequest) (ModelCatalogResponse, error) {
		called <- in.Type
		return ModelCatalogResponse{Models: []ModelCatalogModel{}}, nil
	}, nil)
	enabled := true
	m.configure(&config.AIConfig{AutoUpdateModelCatalog: &enabled, Providers: []config.AIProvider{openrouter, ollama}})
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { m.run(ctx); close(done) }()
	defer func() { cancel(); <-done }()
	select {
	case providerType := <-called:
		if providerType != "ollama" {
			t.Fatalf("background discovery contacted %s instead of Ollama", providerType)
		}
	case <-time.After(time.Second):
		t.Fatal("background discovery did not contact Ollama")
	}
	select {
	case providerType := <-called:
		t.Fatalf("unexpected background discovery of %s", providerType)
	case <-time.After(100 * time.Millisecond):
	}
	// Explicit discovery is independent of the automatic-update setting.
	for _, autoUpdate := range []bool{true, false} {
		m.configure(&config.AIConfig{AutoUpdateModelCatalog: &autoUpdate, Providers: []config.AIProvider{openrouter, ollama}})
		if _, err := m.sync(ctx, providerCatalogRequest(openrouter, "key")); err != nil {
			t.Fatalf("explicit OpenRouter discovery: %v", err)
		}
		if providerType := <-called; providerType != "openrouter" {
			t.Fatalf("explicit discovery contacted %s", providerType)
		}
	}
	if _, err := config.ReadModelCatalogSnapshot(m.root, config.ModelCatalogIdentity(openrouter, "key")); err != nil {
		t.Fatalf("explicit OpenRouter discovery did not persist its snapshot: %v", err)
	}
}

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
