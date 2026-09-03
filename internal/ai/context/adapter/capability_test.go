package adapter

import (
	"context"
	"testing"

	"github.com/floegence/redeven/internal/ai/context/model"
	"github.com/floegence/redeven/internal/config"
)

func TestResolver_Resolve_UsesCuratedNativeModelMetadata(t *testing.T) {
	t.Parallel()

	resolver := NewResolver()
	tests := []struct {
		name       string
		provider   config.AIProvider
		modelID    string
		wantCtx    int
		wantOutput int
	}{
		{
			name:       "moonshot_kimi_k2_6",
			provider:   config.AIProvider{ID: "moonshot", Type: "moonshot"},
			modelID:    "moonshot/kimi-k2.6",
			wantCtx:    256000,
			wantOutput: 96000,
		},
		{
			name:       "glm_5_1",
			provider:   config.AIProvider{ID: "glm", Type: "chatglm"},
			modelID:    "glm/glm-5.1",
			wantCtx:    200000,
			wantOutput: 128000,
		},
		{
			name:       "deepseek_v4_pro",
			provider:   config.AIProvider{ID: "deepseek", Type: "deepseek"},
			modelID:    "deepseek/deepseek-v4-pro",
			wantCtx:    1000000,
			wantOutput: 384000,
		},
		{
			name:       "deepseek_v4_flash",
			provider:   config.AIProvider{ID: "deepseek", Type: "deepseek"},
			modelID:    "deepseek/deepseek-v4-flash",
			wantCtx:    1000000,
			wantOutput: 384000,
		},
		{
			name:       "qwen_3_6_plus",
			provider:   config.AIProvider{ID: "qwen", Type: "qwen"},
			modelID:    "qwen/qwen3.6-plus",
			wantCtx:    1000000,
			wantOutput: 65536,
		},
		{
			name:       "qwen_3_6_flash_snapshot",
			provider:   config.AIProvider{ID: "qwen", Type: "qwen"},
			modelID:    "qwen/qwen3.6-flash-2026-04-16",
			wantCtx:    1000000,
			wantOutput: 65536,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			cap, err := resolver.Resolve(context.Background(), tc.provider, tc.modelID)
			if err != nil {
				t.Fatalf("Resolve: %v", err)
			}
			if cap.MaxContextTokens != tc.wantCtx {
				t.Fatalf("MaxContextTokens=%d, want %d", cap.MaxContextTokens, tc.wantCtx)
			}
			if cap.MaxOutputTokens != tc.wantOutput {
				t.Fatalf("MaxOutputTokens=%d, want %d", cap.MaxOutputTokens, tc.wantOutput)
			}
		})
	}
}

func TestResolver_Resolve_UsesProviderModelContextWindow(t *testing.T) {
	t.Parallel()

	resolver := NewResolver()
	provider := config.AIProvider{
		ID:   "compat",
		Type: "openai_compatible",
		Models: []config.AIProviderModel{
			{
				ModelName:                     "custom-model",
				ContextWindow:                 200000,
				MaxOutputTokens:               32000,
				EffectiveContextWindowPercent: 90,
				InputModalities:               []string{config.AIInputModalityText},
			},
		},
	}

	cap, err := resolver.Resolve(context.Background(), provider, "compat/custom-model")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if cap.MaxContextTokens != 180000 {
		t.Fatalf("MaxContextTokens=%d, want 180000", cap.MaxContextTokens)
	}
	if cap.MaxOutputTokens != 32000 {
		t.Fatalf("MaxOutputTokens=%d, want 32000", cap.MaxOutputTokens)
	}
	if cap.SupportsImageInput {
		t.Fatalf("SupportsImageInput=true, want false")
	}
}

func TestResolver_Resolve_UsesProviderModelWireNameForReasoningCatalog(t *testing.T) {
	t.Parallel()

	resolver := NewResolver()
	provider := config.AIProvider{
		ID:   "groq",
		Type: "groq",
		Models: []config.AIProviderModel{
			{
				ModelName:     "gpt-oss-120b",
				WireModelName: "openai/gpt-oss-120b",
				ContextWindow: 131072,
			},
		},
	}

	cap, err := resolver.Resolve(context.Background(), provider, "groq/gpt-oss-120b")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if cap.ModelName != "gpt-oss-120b" {
		t.Fatalf("ModelName=%q, want local model name", cap.ModelName)
	}
	if cap.WireModelName != "openai/gpt-oss-120b" {
		t.Fatalf("WireModelName=%q, want official provider model id", cap.WireModelName)
	}
	if cap.ReasoningCapability.WireShape != "groq_gpt_oss_reasoning_effort" {
		t.Fatalf("ReasoningCapability=%+v, want Groq GPT-OSS reasoning catalog row", cap.ReasoningCapability)
	}
}

func TestResolver_Resolve_UsesExplicitProviderModelModalities(t *testing.T) {
	t.Parallel()

	resolver := NewResolver()
	provider := config.AIProvider{
		ID:   "compat",
		Type: "openai_compatible",
		Models: []config.AIProviderModel{
			{
				ModelName:       "custom-vision-model",
				ContextWindow:   128000,
				MaxOutputTokens: 8192,
				InputModalities: []string{config.AIInputModalityText, config.AIInputModalityImage},
			},
		},
	}

	cap, err := resolver.Resolve(context.Background(), provider, "compat/custom-vision-model")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if !cap.SupportsImageInput {
		t.Fatalf("SupportsImageInput=false, want true")
	}
	if cap.SupportsFileInput {
		t.Fatalf("SupportsFileInput=true, want false")
	}
}

func TestResolver_Resolve_DoesNotUseModelNameSubstringHeuristics(t *testing.T) {
	t.Parallel()

	resolver := NewResolver()
	cap, err := resolver.Resolve(context.Background(), config.AIProvider{ID: "openai", Type: "openai"}, "openai/acme-mini-vision")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if cap.MaxContextTokens != 128000 {
		t.Fatalf("MaxContextTokens=%d, want provider default 128000", cap.MaxContextTokens)
	}
	if cap.MaxOutputTokens != 4096 {
		t.Fatalf("MaxOutputTokens=%d, want provider default 4096", cap.MaxOutputTokens)
	}
	if cap.SupportsImageInput {
		t.Fatalf("SupportsImageInput=true, want false without explicit metadata")
	}
}

func TestAdaptAttachments_DegradeUnsupportedModes(t *testing.T) {
	t.Parallel()

	cap := model.ModelCapability{
		SupportsImageInput: false,
		SupportsFileInput:  false,
	}
	items := []model.AttachmentManifest{
		{Name: "img", MimeType: "image/png", URL: "file:///tmp/a.png"},
		{Name: "txt", MimeType: "text/plain", URL: "file:///tmp/a.txt"},
	}
	out := AdaptAttachments(cap, items)
	if len(out) != 2 {
		t.Fatalf("len(out)=%d, want 2", len(out))
	}
	if out[0].Mode != "text_reference" {
		t.Fatalf("out[0].Mode=%q, want text_reference", out[0].Mode)
	}
	if out[1].Mode != "text_reference" {
		t.Fatalf("out[1].Mode=%q, want text_reference", out[1].Mode)
	}
}
