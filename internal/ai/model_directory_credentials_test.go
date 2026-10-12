package ai

import (
	"testing"

	"github.com/floegence/redeven/internal/config"
)

func TestModelDirectoryResolvesAPIKeyByProviderIdentity(t *testing.T) {
	provider := config.AIProvider{ID: "my-openai", Type: "openai", Models: []config.AIProviderModel{{ModelName: "gpt-5-mini", ContextWindow: 400000}}}
	s := &Service{resolveProviderKey: func(id string) (string, bool, error) {
		if id != provider.ID {
			t.Errorf("credential lookup used %q instead of provider ID", id)
			return "", false, nil
		}
		return "test-api-key", true, nil
	}}
	out := ModelsResponse{Models: []Model{{ID: "my-openai/gpt-5-mini"}}, Runtime: &AIRuntimeStatus{}}
	out.Directory = s.projectModelDirectory(&config.AIConfig{Providers: []config.AIProvider{provider}}, &out, false, nil, nil, nil, nil)
	if len(out.Directory.Sources) != 1 || out.Directory.Sources[0].State != "ready" {
		t.Fatalf("configured API-key source was unavailable: %+v", out.Directory)
	}
}
