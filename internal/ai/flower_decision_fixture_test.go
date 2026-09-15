package ai

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	flconfig "github.com/floegence/floret/v7/config"
	"github.com/floegence/floret/v7/florettest"
	flprovider "github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/storage"
	fltools "github.com/floegence/floret/v7/tools"
)

// These sanitized fixtures are consumed by the real Flower mapper and browser
// tests. Only runtime identities are normalized; presentation comes from actual
// provider calls through the published Floret runtime and Redeven tool registry.
func TestFlowerDecisionCurrentFixtures(t *testing.T) {
	cases := []struct{ name, tool, args string }{
		{"ask_rich", "ask_user", `{"reason_code":"user_decision_required","required_from_user":["channel"],"evidence_refs":[],"questions":[{"id":"channel","header":"Release channel","question":"Which release channel should Flower use?","response_mode":"select_or_write","is_secret":false,"choices_exhaustive":false,"write_placeholder":"Describe another channel","choices":[{"choice_id":"stable","label":"Stable","description":"Use the version tested for production.","kind":"select"},{"choice_id":"beta","label":"Beta","description":"Try new features before general release.","kind":"select"}]}]}`},
		{"ask_sparse", "ask_user", `{"reason_code":"user_decision_required","required_from_user":["channel"],"evidence_refs":[],"questions":[{"id":"channel","header":"Release channel","question":"Which release channel should Flower use?","response_mode":"select","is_secret":false,"choices_exhaustive":true,"choices":[{"choice_id":"stable","label":"Stable","kind":"select"},{"choice_id":"beta","label":"Beta","kind":"select"}]}]}`},
		{"ask_long", "ask_user", `{"reason_code":"user_decision_required","required_from_user":["channel"],"evidence_refs":[],"questions":[{"id":"channel","header":"Choose how to continue","question":"The current deployment has completed its checks. Before I prepare the next step, which release channel should Flower use for this workspace, considering whether you need the version tested for production or want to evaluate the upcoming features?","response_mode":"select","is_secret":false,"choices_exhaustive":true,"choices":[{"choice_id":"stable","label":"Stable","kind":"select"},{"choice_id":"beta","label":"Beta","kind":"select"}]}]}`},
		// Chinese content intentionally verifies language-sensitive tool presentation.
		{"ask_zh", "ask_user", `{"reason_code":"user_decision_required","required_from_user":["channel"],"evidence_refs":[],"questions":[{"id":"channel","header":"选择发布渠道","question":"Flower 应使用哪个发布渠道？","response_mode":"select_or_write","is_secret":false,"choices_exhaustive":false,"write_label":"使用其他渠道","write_placeholder":"描述你希望使用的渠道","choices":[{"choice_id":"stable","label":"稳定版","description":"使用已完成生产验证的版本。","kind":"select"},{"choice_id":"beta","label":"测试版","kind":"select"}]}]}`},
		{"approval_date", "terminal.exec", `{"command":"date","description":"Check the current system time","yield_ms":10000}`},
		{"approval_date_zh", "terminal.exec", `{"command":"date","description":"执行 date 命令查看当前系统时间","yield_ms":10000}`},
		{"approval_multiline", "terminal.exec", `{"command":"printf 'Current time:\\n'\ndate\nprintf 'Working directory:\\n'\npwd","description":"Inspect the system time and working directory","yield_ms":10000}`},
	}
	fixtures := make(map[string]flruntime.ThreadView)
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			gateway := florettest.NewScriptedGateway(flprovider.Identity{Provider: "test", Model: "decision", StateCompatibilityKey: "test:decision:v1"}, flprovider.Capabilities{Reasoning: flprovider.ReasoningUnsupported}, florettest.Step{Events: []flprovider.Event{{Type: flprovider.EventToolCalls, ToolCalls: []flprovider.ToolCall{{ID: "decision-call", Name: tc.tool, Args: tc.args}}}, {Type: flprovider.EventDone, Reason: "tool_calls"}}})
			var options []flruntime.AgentOption
			if tc.tool != "ask_user" {
				var definition ToolDef
				for _, candidate := range builtInToolDefinitions() {
					if candidate.Name == tc.tool {
						definition = candidate
						break
					}
				}
				presentation, err := floretToolDefinitionForSnapshot(definition, buildPermissionSnapshot(FlowerPermissionApprovalRequired, []ToolDef{definition}, nil))
				if err != nil {
					t.Fatal(err)
				}
				tool := fltools.Define[map[string]any](presentation, nil, nil, func(context.Context, fltools.Invocation[map[string]any]) (fltools.Result, error) {
					t.Error("fixture must not execute an approved effect")
					return fltools.Result{}, nil
				})
				options = append(options, flruntime.WithAgentTools(tool), flruntime.WithAgentEffectAuthorization(floretAllowTestEffect))
			}
			agent, err := flruntime.NewAgent(flconfig.AgentConfig{Profile: flconfig.AgentProfile{ID: "decision", Name: "Decision"}, SystemPrompt: "Test decision presentation.", Context: flconfig.ContextPolicy{ContextWindowTokens: flconfig.DefaultContextWindowTokens}}, gateway, options...)
			if err != nil {
				t.Fatal(err)
			}
			host, err := flruntime.Open(t.Context(), flruntime.Options{Storage: storage.Memory()})
			if err != nil {
				t.Fatal(err)
			}
			defer func() {
				if err := host.Shutdown(context.Background()); err != nil {
					t.Errorf("shutdown fixture host: %v", err)
				}
			}()
			service, err := host.ThreadService(flruntime.AgentFactoryFunc(func(context.Context, flruntime.AgentRequest) (*flruntime.Agent, error) { return agent, nil }))
			if err != nil {
				t.Fatal(err)
			}
			created, err := service.Create(t.Context(), flruntime.CreateThreadInput{RequestKey: "create"})
			if err != nil {
				t.Fatal(err)
			}
			subscription, err := service.Subscribe(t.Context())
			if err != nil {
				t.Fatal(err)
			}
			defer subscription.Close()
			if _, err := service.Send(t.Context(), flruntime.SendInput{ThreadID: created.ThreadID, Input: flruntime.UserInput{Text: "Review the requested action"}, RequestKey: "send"}); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
			defer cancel()
			for {
				current, err := subscription.Next(ctx)
				if err != nil {
					t.Fatal(err)
				}
				if len(current.Interactions) == 0 {
					continue
				}
				interaction := current.Interactions[0]
				interaction.ID = "decision-interaction"
				interaction.TurnID = "turn-fixture"
				interaction.RunID = "run-fixture"
				if interaction.Input != nil {
					encoded, _ := json.Marshal(interaction.Input)
					var wire struct {
						Questions []struct {
							Header  string `json:"header"`
							Choices []any  `json:"choices"`
						} `json:"questions"`
					}
					if err := json.Unmarshal(encoded, &wire); err != nil {
						t.Fatal(err)
					}
					if len(wire.Questions) == 0 || wire.Questions[0].Header == "" || len(wire.Questions[0].Choices) == 0 {
						t.Fatalf("runtime dropped question metadata: %s", encoded)
					}
				}
				fixtures[tc.name] = flruntime.ThreadView{ThreadID: "thread-fixture", ViewVersion: 1, TurnID: "turn-fixture", RunID: "run-fixture", Activity: flruntime.ThreadActivityActive, Attention: current.Attention, Interactions: []flruntime.ThreadInteraction{interaction}, Items: []flruntime.ThreadItem{}}
				break
			}
		})
	}
	if t.Failed() {
		return
	}
	actual, err := json.MarshalIndent(fixtures, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	actual = append(actual, '\n')
	path := filepath.Join("..", "flower_ui", "src", "testdata", "decisionCurrentViews.json")
	if os.Getenv("UPDATE_FLOWER_DECISION_FIXTURES") == "1" {
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, actual, 0644); err != nil {
			t.Fatal(err)
		}
	}
	expected, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(expected) != string(actual) {
		t.Fatal("published runtime decision fixtures changed; review and regenerate with UPDATE_FLOWER_DECISION_FIXTURES=1")
	}
}
