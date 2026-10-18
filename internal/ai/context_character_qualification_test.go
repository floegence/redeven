package ai

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	flconfig "github.com/floegence/floret/v7/config"
	"github.com/floegence/floret/v7/observation"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/chatgpt"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/settings"
	openai "github.com/openai/openai-go/v3"
	ooption "github.com/openai/openai-go/v3/option"
)

// This explicit qualification spends real account usage. It reads an existing
// access token without refreshing or modifying the production store. The
// isolated Runtime receives only a temporary access-token registration, never
// a refresh token, ID token, production history, or production configuration.
func TestOfficialAccountCharacterQualification(t *testing.T) {
	root := os.Getenv("REDEVEN_CONTEXT_OFFICIAL_STATE")
	if root == "" {
		t.Skip("explicit official-account qualification only")
	}
	raw, err := os.ReadFile(filepath.Join(root, "secrets.json"))
	if err != nil {
		t.Fatal(err)
	}
	// Secret JSON fields use snake_case.
	var secrets map[string]json.RawMessage
	if err := json.Unmarshal(raw, &secrets); err != nil {
		t.Fatal("invalid account store")
	}
	var accounts struct {
		Accounts map[string]settings.ChatGPTAccount `json:"accounts"`
	}
	if err := json.Unmarshal(secrets["chatgpt"], &accounts); err != nil {
		t.Fatal("read account registration")
	}
	token := ""
	var selected settings.ChatGPTAccount
	for _, a := range accounts.Accounts {
		if a.AccessToken != "" && time.Now().Before(a.ExpiresAt) && a.PlanEnabled() {
			token = a.AccessToken
			selected = settings.ChatGPTAccount{Issuer: a.Issuer, Subject: a.Subject, ClientID: a.ClientID, AccessToken: a.AccessToken, Scopes: append([]string(nil), a.Scopes...), ExpiresAt: a.ExpiresAt, EarliestRefreshAt: a.ExpiresAt}
			break
		}
	}
	if token == "" {
		t.Fatal("external blocker: no currently valid official account access token; production registration is read-only")
	}
	model := os.Getenv("REDEVEN_CONTEXT_OFFICIAL_MODEL")
	if model == "" {
		model = "gpt-6.1-sol"
	}
	var sent []byte
	var terminal []byte
	provider := &openAIProvider{providerType: "openai", officialOpenAI: true, strictToolSchema: true, chatGPT: true,
		chatGPTToken: func(context.Context) (string, error) { return token, nil },
		client: openai.NewClient(ooption.WithAPIKey("qualification-token-supplied-at-dispatch"), ooption.WithBaseURL("https://api.openai.com/v1"), ooption.WithMaxRetries(0), ooption.WithMiddleware(func(r *http.Request, next ooption.MiddlewareNext) (*http.Response, error) {
			sent, _ = io.ReadAll(r.Body)
			r.Body = io.NopCloser(bytes.NewReader(sent))
			response, err := next(r)
			if err == nil && response != nil {
				response.Body = &qualificationCapture{ReadCloser: response.Body, captured: &terminal}
			}
			return response, err
		})),
	}
	tool := ToolDef{Name: "qualification_read", Description: "Read a fixed qualification result.", InputSchema: json.RawMessage("{\"type\":\"object\",\"properties\":{},\"additionalProperties\":false}")}
	cases := []struct {
		name, text string
		tools      bool
		search     bool
	}{
		{"text", "Reply only ACK. 中文 👩‍💻 e\u0301\n", false, false},
		{"tool_definitions", "Reply only ACK. Do not call a tool.", true, false},
		{"long_result", "Read the supplied prior result and reply ACK.", true, false},
		{"search_unused", "Reply only ACK. Do not search.", false, true},
		{"search_once", "Use one web search for the official OpenAI Responses API documentation and report its title. Keep the answer short.", false, true},
		{"search_multiple", "Perform two separate web searches: official OpenAI Responses API docs, then official Go release notes. Report two titles only.", false, true},
	}
	var previous *ModelGatewayState
	var previousText string
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := ModelGatewayRequest{Model: model, Messages: []Message{{Role: "system", Content: []ContentPart{{Type: "text", Text: "Follow the user request precisely. Keep the answer brief."}}}, {Role: "user", Content: []ContentPart{{Type: "text", Text: tc.text}}}}}
			if tc.tools {
				req.Tools = []ToolDef{tool}
			}
			if tc.search {
				req.WebSearchMode = providerWebSearchModeOpenAIResponsesBuiltin
			}
			if tc.name == "long_result" {
				req.Messages = append(req.Messages, Message{Role: "assistant", Content: []ContentPart{{Type: "tool_call", ToolName: tool.Name, ToolCallID: "qualification-history", ArgsJSON: "{}"}}}, Message{Role: "tool", Content: []ContentPart{{Type: "tool_result", ToolCallID: "qualification-history", Text: strings.Repeat("fixed 中文 👩‍💻 e\u0301\n", 4000)}}})
			}
			ctx, cancel := context.WithTimeout(t.Context(), 90*time.Second)
			defer cancel()
			prepared, err := provider.prepareTurn(ctx, req)
			if err != nil {
				t.Fatal(err)
			}
			defer prepared.Close()
			estimate := prepared.TokenEstimate()
			if estimate.Characters == nil {
				t.Fatal("frozen chars unavailable")
			}
			sent = nil
			terminal = nil
			result, err := prepared.StreamTurn(ctx, nil)
			if err != nil {
				t.Fatalf("official request failed: %v", err)
			}
			assertQualificationBody(t, prepared, estimate.Characters, sent, result.Usage)
			assertQualificationNativeUsage(t, result.Usage, terminal)
			if tc.name == "text" {
				previous = result.ProviderState
				previousText = result.Text
			}
			searches := qualificationSearchCount(t, terminal)
			t.Logf("official case=%s model=%s fingerprint=%s chars=%d native_input=%d search_calls=%d", tc.name, model, prepared.RenderedPayloadFingerprint(), estimate.Characters.TotalCharacters, result.Usage.InputTokens+result.Usage.CacheReadTokens+result.Usage.CacheWriteTokens, searches)
			if tc.name == "search_once" && searches != 1 {
				t.Fatalf("expected one completed search, got %d", searches)
			}
			if tc.name == "search_multiple" && searches < 2 {
				t.Fatalf("expected multiple completed searches, got %d", searches)
			}
			if tc.name == "search_unused" && searches != 0 {
				t.Fatal("unused search scenario unexpectedly searched")
			}
		})
	}
	t.Run("reasoning_replay", func(t *testing.T) {
		if previous == nil {
			t.Fatal("text scenario did not produce replay state")
		}
		req := ModelGatewayRequest{Model: model, PreviousState: previous, Messages: []Message{{Role: "system", Content: []ContentPart{{Type: "text", Text: "Follow the user request precisely. Keep the answer brief."}}}, {Role: "user", Content: []ContentPart{{Type: "text", Text: cases[0].text}}}, {Role: "assistant", Content: []ContentPart{{Type: "text", Text: previousText}}}, {Role: "user", Content: []ContentPart{{Type: "text", Text: "Reply ACK again."}}}}}
		ctx, cancel := context.WithTimeout(t.Context(), 90*time.Second)
		defer cancel()
		prepared, err := provider.prepareTurn(ctx, req)
		if err != nil {
			t.Fatal(err)
		}
		defer prepared.Close()
		estimate := prepared.TokenEstimate()
		sent = nil
		terminal = nil
		result, err := prepared.StreamTurn(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		assertQualificationBody(t, prepared, estimate.Characters, sent, result.Usage)
		assertQualificationNativeUsage(t, result.Usage, terminal)
		if !bytes.Contains(sent, []byte("encrypted_content")) {
			t.Fatal("official response did not exercise opaque reasoning replay")
		}
		t.Logf("official case=reasoning_replay fingerprint=%s chars=%d", prepared.RenderedPayloadFingerprint(), estimate.Characters.TotalCharacters)
	})
	t.Run("isolated_runtime", func(t *testing.T) { qualifyOfficialRuntime(t, selected, model) })
}

type qualificationCapture struct {
	io.ReadCloser
	captured *[]byte
}

func (c *qualificationCapture) Read(p []byte) (int, error) {
	n, err := c.ReadCloser.Read(p)
	*c.captured = append(*c.captured, p[:n]...)
	return n, err
}

func assertQualificationBody(t *testing.T, prepared preparedModelGatewayTurn, chars *flconfig.ContextCharacterBreakdown, body []byte, usage TurnUsage) {
	t.Helper()
	if prepared.RenderedPayloadFingerprint() != fmt.Sprintf("sha256:%x", sha256.Sum256(body)) {
		t.Fatal("sent fingerprint differs")
	}
	if chars == nil || chars.Validate() != nil {
		t.Fatal("invalid frozen characters")
	}
	if got := independentResponseCharacters(t, body); got != chars.TotalCharacters {
		t.Fatalf("independent chars=%d frozen chars=%d", got, chars.TotalCharacters)
	}
	status := observation.ContextStatus{RunID: "qualification", RequestID: "request", PayloadFingerprint: prepared.RenderedPayloadFingerprint(), Provider: "openai", Model: "official", Phase: observation.ContextPhaseProviderUsage, Status: observation.ContextStatusStable, Usage: qualificationObservationUsage(usage), RequestEstimate: flconfig.RequestEstimate{Characters: chars}}
	sample, err := flowerContextSampleFromFloret(&status)
	if err != nil || !sample.CharactersAvailable || sample.Characters.TotalCharacters != chars.TotalCharacters || sample.PayloadFingerprint != prepared.RenderedPayloadFingerprint() || sample.InputTokens != usage.InputTokens+usage.CacheReadTokens+usage.CacheWriteTokens {
		t.Fatal("same-request mapping failed")
	}
}
func assertQualificationNativeUsage(t *testing.T, usage TurnUsage, sse []byte) {
	t.Helper()
	for _, line := range bytes.Split(sse, []byte("\n")) {
		if !bytes.HasPrefix(line, []byte("data: ")) {
			continue
		}
		var event map[string]json.RawMessage
		if json.Unmarshal(line[6:], &event) != nil || string(event["type"]) != "\"response.completed\"" {
			continue
		}
		var response struct {
			Usage struct {
				Input        int64 `json:"input_tokens"`
				Output       int64 `json:"output_tokens"`
				Total        int64 `json:"total_tokens"`
				InputDetails struct {
					Cached int64 `json:"cached_tokens"`
				} `json:"input_tokens_details"`
				OutputDetails struct {
					Reasoning int64 `json:"reasoning_tokens"`
				} `json:"output_tokens_details"`
			} `json:"usage"`
		}
		_ = json.Unmarshal(event["response"], &response)
		normalized := floretUsageFromFlower(usage)
		if !normalized.HasInputUsage() || normalized.InputTokenScope != "provider_execution" || normalized.InputTokens+normalized.CacheReadTokens+normalized.CacheWriteTokens != response.Usage.Input || normalized.TotalTokens != response.Usage.Total || normalized.CacheReadTokens != response.Usage.InputDetails.Cached || normalized.OutputTokens != response.Usage.Output || normalized.ReasoningTokens != response.Usage.OutputDetails.Reasoning || !normalized.OutputIncludesReasoning {
			t.Fatal("native usage changed at adapter boundary")
		}
		return
	}
	t.Fatal("official terminal usage missing")
}

// Independent test oracle for the supported Responses surface; no tokenizer,
// budget, provider usage, or production collector is used here.
func independentResponseCharacters(t *testing.T, raw []byte) int64 {
	t.Helper()
	var b map[string]any
	if json.Unmarshal(raw, &b) != nil {
		t.Fatal("invalid body")
	}
	n := int64(0)
	text := func(v any) {
		if s, ok := v.(string); ok {
			n += int64(utf8.RuneCountInString(s))
		}
	}
	schema := func(v any) {
		if v == nil {
			return
		}
		var buf bytes.Buffer
		e := json.NewEncoder(&buf)
		e.SetEscapeHTML(false)
		_ = e.Encode(v)
		n += int64(utf8.RuneCount(bytes.TrimSuffix(buf.Bytes(), []byte("\n"))))
	}
	var parts func(any)
	parts = func(v any) {
		if s, ok := v.(string); ok {
			text(s)
			return
		}
		if list, ok := v.([]any); ok {
			for _, item := range list {
				m, _ := item.(map[string]any)
				text(m["text"])
			}
		}
	}
	text(b["instructions"])
	if list, ok := b["input"].([]any); ok {
		for _, item := range list {
			m, _ := item.(map[string]any)
			switch m["type"] {
			case "function_call":
				text(m["name"])
				var args any
				s, _ := m["arguments"].(string)
				if json.Unmarshal([]byte(s), &args) == nil {
					schema(args)
				} else {
					text(s)
				}
			case "function_call_output":
				parts(m["output"])
			case "reasoning":
				parts(m["summary"])
				parts(m["content"])
			case "web_search_call":
				schema(m["action"])
			default:
				parts(m["content"])
			}
		}
	}
	var tools func(any)
	tools = func(v any) {
		if list, ok := v.([]any); ok {
			for _, item := range list {
				m, _ := item.(map[string]any)
				if nested, ok := m["tools"]; ok {
					tools(nested)
					continue
				}
				clean := map[string]any{}
				for k, v := range m {
					if k != "cache_control" && k != "annotations" {
						clean[k] = v
					}
				}
				schema(clean)
			}
		}
	}
	tools(b["tools"])
	if config, ok := b["text"].(map[string]any); ok {
		schema(config["format"])
	}
	schema(b["response_format"])
	return n
}

func qualificationObservationUsage(usage TurnUsage) observation.ProviderUsage {
	u := floretUsageFromFlower(usage)
	return observation.ProviderUsage{Source: "native", Available: u.Available, InputTokensReported: u.InputTokensReported, InputTokenScope: u.InputTokenScope, InputTokens: u.InputTokens, CacheReadTokens: u.CacheReadTokens, CacheWriteTokens: u.CacheWriteTokens, OutputTokens: u.OutputTokens, ReasoningTokens: u.ReasoningTokens, OutputIncludesReasoning: u.OutputIncludesReasoning, TotalTokens: u.TotalTokens, TotalTokensReported: u.TotalTokensReported, WindowInputTokens: u.InputTokens + u.CacheReadTokens + u.CacheWriteTokens}
}

// Count unique completed output items, not repeated streaming notifications.
func qualificationSearchCount(t *testing.T, sse []byte) int {
	t.Helper()
	ids := map[string]bool{}
	completed := false
	for _, line := range bytes.Split(sse, []byte("\n")) {
		if !bytes.HasPrefix(line, []byte("data: ")) {
			continue
		}
		type item struct {
			ID     string
			Type   string
			Status string
			Action struct{ Type string }
		}
		var e struct {
			Type     string
			Item     item
			Response struct{ Output []item }
		}
		if json.Unmarshal(line[6:], &e) != nil {
			continue
		}
		items := e.Response.Output
		if e.Type == "response.output_item.done" {
			items = append(items, e.Item)
		}
		if e.Type == "response.completed" {
			completed = true
		}
		for _, v := range items {
			if v.Type == "web_search_call" && v.Action.Type == "search" && v.Status == "completed" {
				t.Logf("search output event=%s id=%s status=%s action=%s", e.Type, v.ID, v.Status, v.Action.Type)
				if v.ID == "" {
					t.Fatal("completed search lacks identity")
				}
				ids[v.ID] = true
			}
		}
	}
	if !completed {
		t.Fatal("official completed response missing")
	}
	return len(ids)
}

// Real product Service and published Floret Runtime with disposable state.
func qualifyOfficialRuntime(t *testing.T, account settings.ChatGPTAccount, model string) {
	t.Helper()
	state := t.TempDir()
	store := settings.NewSecretsStore(filepath.Join(state, "secrets.json"))
	if err := store.UpdateChatGPTAccount(t.Context(), account.ID(), func(a *settings.ChatGPTAccount) error { *a = account; return nil }); err != nil {
		t.Fatal(err)
	}
	modelID := "official/" + model
	opts := Options{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), StateDir: state, AgentHomeDir: state, Shell: "/bin/sh", ChatGPT: chatgpt.New(store), Config: &config.AIConfig{CurrentModelID: modelID, Providers: []config.AIProvider{{ID: "official", Type: "openai", AuthMethod: config.AIAuthChatGPT, AccountID: account.ID(), BaseURL: chatgpt.Resource, ModelSelection: &config.AIModelSelection{SelectedModels: []string{model}}, Models: []config.AIProviderModel{{ModelName: model, ContextWindow: 1048576, MaxOutputTokens: 4096}}}}}}
	svc, err := NewService(opts)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if svc != nil {
			_ = svc.Close()
		}
	}()
	ctx, cancel := context.WithTimeout(t.Context(), 2*time.Minute)
	defer cancel()
	meta := testSendTurnMeta()
	if _, err := svc.DiscoverModelCatalog(ctx, ModelCatalogRequest{ProviderID: "official", Type: "openai", BaseURL: chatgpt.Resource, AuthMethod: config.AIAuthChatGPT, AccountID: account.ID()}); err != nil {
		t.Fatal(err)
	}
	thread, err := svc.CreateThread(ctx, meta, "Character qualification", modelID, config.AIPermissionReadonly, state)
	if err != nil {
		t.Fatal(err)
	}
	receipt, err := svc.SendUserTurn(ctx, meta, SendUserTurnRequest{ThreadID: thread.ThreadID, ClientRequestID: "official-chars", Input: RunInput{Text: "Reply only ACK. This is a synthetic accounting check. Do not use tools or ask questions. 中文 👩‍💻 é"}, Options: RunOptions{NoUserInteraction: true}})
	if err != nil {
		t.Fatal(err)
	}
	detail := waitForDeepSeekAskUserDetail(t, ctx, svc, meta, thread.ThreadID, func(d *FlowerThreadDetail) bool {
		return d.Current.TurnID == receipt.Current.TurnID && d.Current.Activity == flruntime.ThreadActivityIdle && d.Current.LastOutcome != nil
	})
	if *detail.Current.LastOutcome != flruntime.TurnOutcomeCompleted {
		code, hash, classes := safeDeepSeekFailureFingerprint(detail.Current.Failure)
		t.Fatalf("official Runtime outcome=%s failure=%s %s %v detail=%+v", *detail.Current.LastOutcome, code, hash, classes, detail.Current.Failure)
	}
	if detail.Thread.ContextUsage == nil || detail.Thread.ContextUsage.Confirmed == nil {
		t.Fatal("Runtime did not confirm usage")
	}
	sample := detail.Thread.ContextUsage.Confirmed
	if !sample.Available || !sample.Measured || !sample.CharactersAvailable || sample.Characters.Validate() != nil || sample.InputTokens <= 0 || sample.PayloadFingerprint == "" {
		t.Fatal("Runtime sample missing same-request facts")
	}
	if detail.Thread.ContextUsage.RecentRequestUsage == nil {
		t.Fatal("Runtime recent usage missing")
	}
	recent := detail.Thread.ContextUsage.RecentRequestUsage
	if recent.InputTokens+recent.CacheReadTokens+recent.CacheWriteTokens != sample.InputTokens {
		t.Fatal("recent cache facts do not match confirmed input")
	}
	t.Logf("official isolated Runtime fingerprint=%s input=%d chars=%d", sample.PayloadFingerprint, sample.InputTokens, sample.Characters.TotalCharacters)
	if err := svc.Close(); err != nil {
		t.Fatal(err)
	}
	svc = nil
	svc, err = NewService(opts)
	if err != nil {
		t.Fatal(err)
	}
	restarted, err := svc.GetFlowerThreadDetail(ctx, meta, thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	if restarted.Thread.ContextUsage == nil || !reflect.DeepEqual(restarted.Thread.ContextUsage.Confirmed, sample) {
		t.Fatal("restart changed confirmed sample")
	}
}
