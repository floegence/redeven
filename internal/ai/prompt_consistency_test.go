package ai

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"strconv"
	"testing"
)

func TestFlowerPromptMatchesSelectedToolSurface(t *testing.T) {
	// Keep the captured definitions immutable: simplifying the persona must
	// not change the permission, interaction, or allowlist contracts.
	var baseline map[string]struct {
		SystemBytes int    `json:"system_bytes"`
		ToolsSHA256 string `json:"tools_sha256"`
	}
	data, err := os.ReadFile("testdata/flower_prompt_boundary_baseline.json")
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &baseline); err != nil {
		t.Fatal(err)
	}
	for _, permission := range []FlowerPermissionType{FlowerPermissionReadonly, FlowerPermissionApprovalRequired, FlowerPermissionFullAccess} {
		for _, profile := range []string{runPromptProfileMainInteractive, runPromptProfileMainAutonomous, runPromptProfileSubagentAutonomous} {
			for _, restricted := range []bool{false, true} {
				name := string(permission) + "/" + profile + "/restricted=" + strconv.FormatBool(restricted)
				t.Run(name, func(t *testing.T) {
					r := newRun(runOptions{AgentHomeDir: t.TempDir(), NoUserInteraction: profile != runPromptProfileMainInteractive})
					if profile == runPromptProfileSubagentAutonomous {
						r.subagentDepth = 1
						r.allowSubagentDelegate = false
					}
					if restricted {
						r.toolAllowlist = map[string]struct{}{"image.read": {}}
					}
					surface, err := r.buildRunToolSurface(runToolSurfaceConfig{}, permission)
					if err != nil {
						t.Fatal(err)
					}
					assertFlowerIdentityPrompt(t, surface.SystemPrompt)
					if surface.CapabilityContract.PromptProfile != profile {
						t.Fatalf("run profile=%q; want %q", surface.CapabilityContract.PromptProfile, profile)
					}
					before, ok := baseline[name]
					if !ok || len(surface.SystemPrompt) >= before.SystemBytes {
						t.Fatalf("core system prompt did not shrink: before=%d after=%d", before.SystemBytes, len(surface.SystemPrompt))
					}
					definitions, err := promptBoundaryToolDefinitions(surface)
					if err != nil {
						t.Fatal(err)
					}
					digest := sha256.Sum256(definitions)
					if hex.EncodeToString(digest[:]) != before.ToolsSHA256 {
						t.Fatal("persona simplification changed provider-visible tool definitions")
					}
				})
			}
		}
	}
}

// Hash only provider-visible definitions, excluding executable Go callbacks.
func promptBoundaryToolDefinitions(surface runToolSurface) ([]byte, error) {
	definitions := make([]map[string]any, 0, len(surface.FloretToolItems))
	for _, tool := range surface.FloretToolItems {
		definition := tool.Definition
		definitions = append(definitions, map[string]any{"name": definition.Name, "description": definition.Description, "input_schema": definition.InputSchema, "output_schema": definition.OutputSchema})
	}
	return json.Marshal(definitions)
}
