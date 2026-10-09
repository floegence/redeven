package ai

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func TestModelCatalogOpenRouterFiltersToolsAndPreservesWireIDs(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" || r.URL.Path != "/models" || r.URL.Query().Get("supported_parameters") != "tools" {
			t.Errorf("unexpected request %s", r.URL)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"openai/agent","name":"Agent","context_length":128000,"supported_parameters":["tools"],"architecture":{"input_modalities":["text","image"],"output_modalities":["text"]},"top_provider":{"max_completion_tokens":16384}},{"id":"embedding","context_length":1000,"supported_parameters":[],"architecture":{"output_modalities":["text"]}},{"id":"retired","expiration_date":"2020-01-01","context_length":128000,"supported_parameters":["tools"],"architecture":{"output_modalities":["text"]}}]}`))
	}))
	defer server.Close()
	out, err := discoverModelCatalog(context.Background(), ModelCatalogRequest{Type: "openrouter", BaseURL: server.URL}, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 1 || out[0].ModelName != "openai%2Fagent" || out[0].WireModelName != "openai/agent" || !out[0].SupportsImageInput() {
		t.Fatalf("catalog = %+v", out)
	}
	if cap := out[0].EffectiveReasoningCapability("openrouter"); !cap.IsZero() {
		t.Fatalf("non-reasoning model inherited controls: %+v", cap)
	}
}

func TestModelCatalogOllamaIncludesOnlyInstalledToolModels(t *testing.T) {
	var shown []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/tags":
			_, _ = w.Write([]byte(`{"models":[{"name":"agent:latest"},{"name":"embedding:latest"},{"name":"cloud:latest","remote_host":"https://ollama.com"}]}`))
		case "/api/ps":
			_, _ = w.Write([]byte(`{"models":[]}`))
		case "/api/show":
			var body map[string]string
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			shown = append(shown, body["model"])
			if body["model"] == "agent:latest" {
				_, _ = w.Write([]byte(`{"capabilities":["completion","tools","vision"],"model_info":{"qwen.context_length":131072},"parameters":"num_ctx 32768"}`))
			} else {
				_, _ = w.Write([]byte(`{"capabilities":["embedding"]}`))
			}
		default:
			t.Errorf("unexpected side-effect request %s", r.URL)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	out, err := discoverModelCatalog(context.Background(), ModelCatalogRequest{Type: "ollama", BaseURL: server.URL + "/v1"}, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 1 || out[0].WireModelName != "agent:latest" || out[0].ContextWindow != 32768 || !out[0].SupportsImageInput() {
		t.Fatalf("catalog = %+v", out)
	}
	if cap := out[0].EffectiveReasoningCapability("ollama"); !cap.IsZero() {
		t.Fatalf("non-reasoning model inherited controls: %+v", cap)
	}
	if strings.Join(shown, ",") != "agent:latest,embedding:latest" {
		t.Fatalf("queried unavailable models: %v", shown)
	}
}

func TestModelCatalogDoesNotForwardCredentialsOnRedirect(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Error("followed catalog redirect") }))
	defer target.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, http.StatusFound) }))
	defer server.Close()
	if _, err := discoverModelCatalog(context.Background(), ModelCatalogRequest{Type: "openrouter", BaseURL: server.URL, APIKey: "test-key"}, server.Client()); err == nil {
		t.Fatal("redirect should be reported")
	}
}

func TestOllamaCatalogUsesServedContextCapacity(t *testing.T) {
	for _, tc := range []struct {
		name       string
		running    int
		parameters string
		want       int
	}{
		{"loaded model", 65536, "num_ctx 32768", 65536},
		{"modelfile", 0, "num_ctx 32768", 32768},
		{"unloaded explicit 128k", 0, "num_ctx 131072", 131072},
		{"unloaded default", 0, "", 4096},
		{"bounded by model", 200000, "", 131072},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch r.URL.Path {
				case "/api/tags":
					_ = json.NewEncoder(w).Encode(map[string]any{"models": []any{map[string]any{"name": "agent:latest"}}})
				case "/api/ps":
					_ = json.NewEncoder(w).Encode(map[string]any{"models": []any{map[string]any{"name": "agent:latest", "context_length": tc.running}}})
				case "/api/show":
					_ = json.NewEncoder(w).Encode(map[string]any{"capabilities": []string{"tools"}, "parameters": tc.parameters, "model_info": map[string]int{"agent.context_length": 131072}})
				default:
					t.Errorf("unexpected request: %s", r.URL)
				}
			}))
			defer server.Close()
			out, err := discoverModelCatalog(context.Background(), ModelCatalogRequest{Type: "ollama", BaseURL: server.URL}, server.Client())
			if err != nil {
				t.Fatal(err)
			}
			if len(out) != 1 || out[0].ContextWindow != tc.want {
				t.Fatalf("catalog = %+v, want context %d", out, tc.want)
			}
		})
	}
}

func TestOfflineOllamaDoesNotDisableOtherProviders(t *testing.T) {
	cfg := &config.AIConfig{CurrentModelID: "local/installed", Providers: []config.AIProvider{
		{ID: "brand", Type: "openai", ModelSelection: &config.AIModelSelection{SelectedModels: []string{"gpt-6-astra"}}},
		{ID: "local", Type: "ollama", BaseURL: "http://127.0.0.1:0", ModelSelection: &config.AIModelSelection{SelectedModels: []string{"agent"}}},
	}}
	svc := &Service{cfg: cfg}
	out, err := svc.ListModels()
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Models) == 0 || out.CurrentModel != cfg.CurrentModelID {
		t.Fatal("offline discovery hid other models or changed the current model")
	}
	resolved, err := resolveModelCatalogs(context.Background(), cfg, nil, "brand/gpt-6-astra")
	if err != nil || !resolved.IsAllowedModelID("brand/gpt-6-astra") {
		t.Fatalf("unrelated offline instance blocked resolution: %v", err)
	}
}

func TestModelDirectoryPreservesUnavailableDesktopSelection(t *testing.T) {
	selected := "desktop:model_" + strings.Repeat("a", 64)
	source := &desktopModelSourceClient{}
	source.SetCurrentModelID(selected)
	svc := &Service{cfg: &config.AIConfig{CurrentModelID: "brand/gpt-6-astra", Providers: []config.AIProvider{
		{ID: "brand", Type: "openai", ModelSelection: &config.AIModelSelection{SelectedModels: []string{"gpt-6-astra"}}},
	}}, desktopModelSource: source}
	for _, baseline := range []bool{true, false} {
		out, err := svc.readModelDirectory(t.Context(), nil, baseline)
		if err != nil {
			t.Fatal(err)
		}
		if out.CurrentModel != selected || !slices.ContainsFunc(out.Directory.Models, func(m ModelDirectoryModel) bool {
			return m.ID == selected && m.Source == modelSourceDesktopModelSource && m.State == "unavailable"
		}) {
			t.Fatalf("baseline=%v lost the exact Desktop selection: %+v", baseline, out)
		}
	}
}

func TestModelDirectoryExcludesUnavailableModelsFromAvailableProjection(t *testing.T) {
	svc := &Service{cfg: &config.AIConfig{CurrentModelID: "brand/gpt-6-astra", Providers: []config.AIProvider{
		{ID: "brand", Type: "openai", ModelSelection: &config.AIModelSelection{SelectedModels: []string{"gpt-6-astra"}}},
	}}, resolveProviderKey: func(string) (string, bool, error) { return "", false, nil }}
	for _, baseline := range []bool{true, false} {
		out, err := svc.readModelDirectory(t.Context(), nil, baseline)
		if err != nil {
			t.Fatal(err)
		}
		if len(out.Models) != 0 || len(out.Directory.Models) != 1 || out.Directory.Models[0].Reason != "missing_keys" {
			t.Fatalf("baseline=%v exposed an unavailable model: %+v", baseline, out)
		}
	}
}

func TestAutomaticCatalogRefreshDoesNotStarveLaterProviders(t *testing.T) {
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	defer slow.Close()
	fast := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/tags":
			_, _ = w.Write([]byte(`{"models":[{"name":"agent:latest"}]}`))
		case "/api/ps":
			_, _ = w.Write([]byte(`{"models":[]}`))
		case "/api/show":
			_, _ = w.Write([]byte(`{"capabilities":["tools"],"model_info":{"agent.context_length":32768}}`))
		default:
			t.Errorf("unexpected catalog request: %s", r.URL)
		}
	}))
	defer fast.Close()
	cfg := &config.AIConfig{CurrentModelID: "fast/agent:latest", Providers: []config.AIProvider{
		{ID: "slow", Type: "ollama", BaseURL: slow.URL, ModelSelection: &config.AIModelSelection{SelectedModels: []string{"missing"}}},
		{ID: "fast", Type: "ollama", BaseURL: fast.URL, ModelSelection: &config.AIModelSelection{SelectedModels: []string{"agent:latest"}}},
	}}
	ctx, cancel := context.WithTimeout(t.Context(), 500*time.Millisecond)
	defer cancel()
	resolved, err := resolveModelCatalogs(ctx, cfg, nil, "")
	if err == nil {
		t.Fatal("expected the slow catalog to time out")
	}
	if !resolved.IsAllowedModelID(cfg.CurrentModelID) {
		t.Fatal("the slow provider starved the later available catalog")
	}
	if cfg.IsAllowedModelID(cfg.CurrentModelID) {
		t.Fatal("inventory refresh mutated saved configuration")
	}
}

func TestInstalledOllamaModelCanCreateThreadAndResolveImageCapability(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/tags":
			_, _ = w.Write([]byte(`{"models":[{"name":"agent:latest"}]}`))
		case "/api/ps":
			_, _ = w.Write([]byte(`{"models":[]}`))
		case "/api/show":
			_, _ = w.Write([]byte(`{"capabilities":["tools","vision"],"parameters":"num_ctx 32768","model_info":{"agent.context_length":131072}}`))
		default:
			t.Errorf("unexpected request: %s", r.URL)
		}
	}))
	defer server.Close()
	cfg := &config.AIConfig{CurrentModelID: "local/agent:latest", Providers: []config.AIProvider{{ID: "local", Type: "ollama", BaseURL: server.URL + "/v1", ModelSelection: &config.AIModelSelection{SelectedModels: []string{"agent:latest"}}}}}
	svc, err := NewService(Options{Config: cfg, StateDir: t.TempDir(), AgentHomeDir: t.TempDir(), Shell: "/bin/sh"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	th, err := svc.buildThreadCreateSettings(context.Background(), &session.Meta{EndpointID: "test", NamespacePublicID: "test"}, CreateThreadRequest{ModelID: cfg.CurrentModelID})
	if err != nil || th.ModelID != cfg.CurrentModelID {
		t.Fatalf("thread settings: %+v, %v", th, err)
	}
	capability := svc.AttachmentCapabilities(context.Background(), cfg.CurrentModelID)
	if got := attachmentRouteForTest(t, capability, "image/png"); got != "native_full_content" {
		t.Fatalf("image route: %s", got)
	}
	if snapshot, _, err := buildDesktopModelSourceModelSnapshot(cfg, nil); err != nil || len(snapshot.Models) != 1 || !snapshot.Models[0].SupportsImageInput {
		t.Fatalf("Ollama requires no API key: %+v, %v", snapshot, err)
	}
	if len(cfg.Providers[0].EffectiveModels()) != 0 {
		t.Fatal("discovery persisted a catalog in the source configuration")
	}
}

func TestAllDisabledModelsKeepCurrentSelectionVisible(t *testing.T) {
	entries := config.AIProviderCatalog("deepseek")
	disabled := make([]string, 0, len(entries))
	for _, entry := range entries {
		disabled = append(disabled, entry.ModelName)
	}
	cfg := &config.AIConfig{CurrentModelID: "brand/" + entries[0].ModelName, Providers: []config.AIProvider{{ID: "brand", Type: "deepseek", BaseURL: "https://api.deepseek.com", ModelSelection: &config.AIModelSelection{DisabledModels: disabled}}}}
	if err := cfg.Validate(); err != nil {
		t.Fatal(err)
	}
	out, err := (&Service{cfg: cfg}).ListModels()
	if err != nil || len(out.Models) != 0 || out.CurrentModel != cfg.CurrentModelID {
		t.Fatalf("disabled range changed current selection: %+v, %v", out, err)
	}
}

func TestModelProviderKeysSupportOptionalEndpointAuthentication(t *testing.T) {
	for _, kind := range []string{"ollama", "google", "deepseek", "openai", "anthropic", "moonshot", "chatglm", "qwen", "openrouter", "xai", "groq", "openai_compatible"} {
		t.Run(kind, func(t *testing.T) {
			empty := func(string) (string, bool, error) { return "", false, nil }
			if _, available, err := resolveModelProviderKey(kind, "provider", empty); err != nil || available != (kind == "ollama" || kind == "openai_compatible") {
				t.Fatalf("empty key: %v, %v", available, err)
			}
			configured := func(string) (string, bool, error) { return " optional-key ", true, nil }
			if key, available, err := resolveModelProviderKey(kind, "provider", configured); err != nil || !available || key != "optional-key" {
				t.Fatalf("configured key ignored: %q, %v, %v", key, available, err)
			}
			denied := errors.New("secret read denied")
			if _, _, err := resolveModelProviderKey(kind, "provider", func(string) (string, bool, error) { return "", false, denied }); !errors.Is(err, denied) {
				t.Fatal("secret failure was ignored")
			}
		})
	}
}

func TestOllamaReasoningCatalogPreservesExactDeclaredControls(t *testing.T) {
	for _, tc := range []struct {
		metadata, kind string
		levels         []string
		off            bool
	}{
		{`{"values":[false,"low","medium","xhigh"],"default":"medium"}`, "effort", []string{"low", "medium", "xhigh"}, true},
		{`{"values":[false,true],"default":false}`, "toggle", []string{"on"}, true},
		{`{"values":[true],"default":true}`, "always_on", nil, false},
		{`{"values":[false],"default":false}`, "", nil, false},
		{`null`, "dynamic", nil, false},
	} {
		t.Run(tc.kind, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch r.URL.Path {
				case "/api/tags":
					_, _ = w.Write([]byte(`{"models":[{"name":"custom-alias:latest"}]}`))
				case "/api/ps":
					_, _ = w.Write([]byte(`{"models":[]}`))
				case "/api/show":
					_ = json.NewEncoder(w).Encode(map[string]any{"capabilities": []string{"tools", "thinking"}, "thinking": json.RawMessage(tc.metadata), "parameters": "num_ctx 131072"})
				default:
					t.Errorf("unexpected request %s", r.URL)
				}
			}))
			defer server.Close()
			models, err := discoverModelCatalog(t.Context(), ModelCatalogRequest{Type: "ollama", BaseURL: server.URL}, server.Client())
			if err != nil || len(models) != 1 {
				t.Fatalf("models=%+v err=%v", models, err)
			}
			cap := models[0].EffectiveReasoningCapability("ollama")
			if cap.Kind != tc.kind || !slices.Equal(cap.SupportedLevels, tc.levels) || cap.DisableSupported != tc.off {
				t.Fatalf("capability=%+v", cap)
			}
			if tc.kind != "" && !slices.Contains(cap.ResponseReasoningFields, "reasoning") {
				t.Fatal("Ollama reasoning output is not visible")
			}
		})
	}
}

func TestOpenRouterReasoningMetadataDoesNotInventEfforts(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"custom/thinking","name":"Thinking","context_length":128000,"supported_parameters":["tools","reasoning"],"architecture":{"output_modalities":["text"]}}]}`))
	}))
	defer server.Close()
	models, err := discoverModelCatalog(t.Context(), ModelCatalogRequest{Type: "openrouter", BaseURL: server.URL}, server.Client())
	if err != nil || len(models) != 1 {
		t.Fatalf("models=%+v err=%v", models, err)
	}
	cap := models[0].EffectiveReasoningCapability("openrouter")
	if cap.Kind != "dynamic" || len(cap.SupportedLevels) != 0 || cap.DisableSupported || !slices.Contains(cap.ResponseReasoningFields, "reasoning") {
		t.Fatalf("capability=%+v", cap)
	}
}

func TestModelCatalogOllamaPreservesQuantizationAndScopesAliases(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/tags":
			_, _ = w.Write([]byte(`{"models":[{"name":"agent:27b","digest":"q8-digest"},{"name":"agent:q8","digest":"q8-digest"},{"name":"agent:q4","digest":"q4-digest"}]}`))
		case "/api/ps":
			_, _ = w.Write([]byte(`{"models":[]}`))
		case "/api/show":
			var body map[string]string
			_ = json.NewDecoder(r.Body).Decode(&body)
			quantization := "Q8_0"
			if body["model"] == "agent:q4" {
				quantization = "Q4_K_M"
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"capabilities": []string{"tools"}, "parameters": "num_ctx 131072", "details": map[string]string{"quantization_level": quantization}})
		default:
			t.Errorf("unexpected request: %s", r.URL)
		}
	}))
	defer server.Close()
	models, err := discoverModelCatalog(context.Background(), ModelCatalogRequest{Type: "ollama", BaseURL: server.URL}, server.Client())
	if err != nil || len(models) != 3 {
		t.Fatalf("catalog identities lost: %+v %v", models, err)
	}
	p := config.AIProvider{ID: "local", Type: "ollama", BaseURL: server.URL}
	if models[0].Quantization != "Q8_0" || models[1].Quantization != "Q4_K_M" {
		t.Fatalf("quantization metadata lost: %+v", models)
	}
	group := modelAliasGroup(p, models[0])
	if group == "" || group != modelAliasGroup(p, models[2]) || group == modelAliasGroup(p, models[1]) {
		t.Fatal("alias groups must distinguish quantization")
	}
	other := p
	other.ID = "other"
	if group == modelAliasGroup(other, models[0]) {
		t.Fatal("different providers folded together")
	}
	other = p
	other.BaseURL += "/other"
	if group == modelAliasGroup(other, models[0]) {
		t.Fatal("different endpoints folded together")
	}
	changed := models[0]
	changed.ContextWindow = 8192
	if group == modelAliasGroup(p, changed) {
		t.Fatal("different parameters folded together")
	}
}
