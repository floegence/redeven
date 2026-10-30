package ai

import (
	"context"
	"testing"

	"github.com/floegence/redeven/internal/ai/context/adapter"
	contextmodel "github.com/floegence/redeven/internal/ai/context/model"
	"github.com/floegence/redeven/internal/config"
)

func attachmentRouteForTest(t *testing.T, capability AttachmentCapabilities, mediaType string) string {
	t.Helper()
	for _, route := range capability.MediaTypes {
		if route.MediaType == mediaType {
			return route.Mode
		}
	}
	t.Fatalf("missing route for %q in %#v", mediaType, capability.MediaTypes)
	return ""
}

func TestEveryModelAdmitsEveryAttachment(t *testing.T) {
	for _, model := range []contextmodel.ModelCapability{{}, {SupportsTools: true}, {SupportsImageInput: true}} {
		capability := attachmentCapabilitiesForModel("model", config.AIProvider{Type: "openai_compatible"}, model)
		if !capability.Enabled || !capability.SupportsLongText {
			t.Fatalf("model capabilities blocked attachment admission: %#v", capability)
		}
		for _, route := range capability.MediaTypes {
			if route.Mode == "unsupported" {
				t.Errorf("attachment rejected before model: %#v", route)
			}
		}
	}
}

func TestAttachmentCapabilitiesFollowResolvedModelAndProviderRoute(t *testing.T) {
	t.Parallel()

	fileCapability := contextmodel.ModelCapability{ModelName: "gpt-test", SupportsFileInput: true}
	file := attachmentCapabilitiesForModel("openai/gpt-test", config.AIProvider{Type: "openai"}, fileCapability)
	if !file.Enabled || !file.SupportsLongText {
		t.Fatalf("file capability=%#v, want enabled long-text support", file)
	}
	if got := attachmentRouteForTest(t, file, "text/plain; charset=utf-8"); got != "native_full_content" {
		t.Fatalf("text route=%q, want native_full_content", got)
	}
	if got := attachmentRouteForTest(t, file, "application/pdf"); got != "native_full_content" {
		t.Fatalf("PDF route=%q, want native_full_content", got)
	}
	if got := attachmentRouteForTest(t, file, "image/png"); got != "attachment_manifest" {
		t.Fatalf("image route=%q, want attachment_manifest", got)
	}

	image := attachmentCapabilitiesForModel("openai/gpt-image", config.AIProvider{Type: "openai"}, contextmodel.ModelCapability{
		ModelName: "gpt-image", SupportsImageInput: true,
	})
	if !image.Enabled || !image.SupportsLongText {
		t.Fatalf("image capability=%#v, want universal admission with native images", image)
	}
	if got := attachmentRouteForTest(t, image, "image/webp"); got != "native_full_content" {
		t.Fatalf("image route=%q, want native_full_content", got)
	}

	toolRead := attachmentCapabilitiesForModel("compat/tool-model", config.AIProvider{Type: "openai_compatible"}, contextmodel.ModelCapability{
		ModelName: "tool-model", SupportsTools: true,
	})
	if !toolRead.Enabled || !toolRead.SupportsLongText {
		t.Fatalf("tool-read capability=%#v, want host-tool support", toolRead)
	}
	if got := attachmentRouteForTest(t, toolRead, "text/plain; charset=utf-8"); got != "tool_read" {
		t.Fatalf("tool-read text route=%q, want tool_read", got)
	}
	for _, mediaType := range []string{"application/pdf", "image/png", "application/octet-stream"} {
		if got := attachmentRouteForTest(t, toolRead, mediaType); got != "tool_read" {
			t.Fatalf("tool-read %s route=%q, want tool_read", mediaType, got)
		}
	}

	noTools := attachmentCapabilitiesForModel("compat/no-tools", config.AIProvider{Type: "openai_compatible"}, contextmodel.ModelCapability{
		ModelName: "no-tools",
	})
	if !noTools.Enabled || !noTools.SupportsLongText || attachmentRouteForTest(t, noTools, "text/plain; charset=utf-8") != "attachment_manifest" {
		t.Fatalf("no-tools capability=%#v, want universal admission", noTools)
	}

	unsupported := attachmentCapabilitiesForModel("compat/model", config.AIProvider{Type: "openai_compatible"}, fileCapability)
	if !unsupported.Enabled || !unsupported.SupportsLongText {
		t.Fatalf("unsupported route capability=%#v, want universal admission", unsupported)
	}
	if unsupported.Revision == file.Revision {
		t.Fatal("revision did not change with the effective route matrix")
	}
	if again := attachmentCapabilitiesForModel("openai/gpt-test", config.AIProvider{Type: "openai"}, fileCapability); again.Revision != file.Revision {
		t.Fatalf("stable capability revision changed: %q != %q", again.Revision, file.Revision)
	}
}

func TestAttachmentAdmissionDoesNotRequireResolvedModel(t *testing.T) {
	t.Parallel()

	got := (&Service{}).AttachmentCapabilities(context.Background(), "missing/model")
	if !got.Enabled || !got.SupportsLongText || got.Revision == "" {
		t.Fatalf("unresolved capability=%#v, want stable upload policy", got)
	}
	for _, route := range got.MediaTypes {
		if route.Mode != "attachment_manifest" {
			t.Fatalf("unresolved route=%#v, want attachment_manifest", route)
		}
	}
}

func TestImageInputIsAnIndependentModelCapability(t *testing.T) {
	for _, providerType := range []string{"openai", "anthropic", "google", "moonshot", "chatglm", "deepseek", "qwen", "xai", "groq", "openrouter", "ollama", "openai_compatible"} {
		t.Run(providerType, func(t *testing.T) {
			provider := config.AIProvider{ID: "mixed", Type: providerType, Models: []config.AIProviderModel{{ModelName: "vision", InputModalities: []string{"text", "image"}}, {ModelName: "text", InputModalities: []string{"text"}}}}
			for _, name := range []string{"vision", "text"} {
				capability, err := adapter.NewResolver().Resolve(context.Background(), provider, "mixed/"+name)
				if err != nil {
					t.Fatal(err)
				}
				if capability.SupportsImageInput != (name == "vision") {
					t.Fatalf("model %s image capability=%v", name, capability.SupportsImageInput)
				}
				view := attachmentCapabilitiesForModel("mixed/"+name, provider, capability)
				for _, media := range view.MediaTypes {
					if media.MediaType == "image/png" && (media.Mode == "native_full_content") != (name == "vision") {
						t.Fatalf("wrong upload route for %s: %+v", name, media)
					}
				}
			}
		})
	}
}
