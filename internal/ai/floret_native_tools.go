package ai

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	flruntime "github.com/floegence/floret/v7/runtime"
	fltools "github.com/floegence/floret/v7/tools"
	"github.com/floegence/floret/v7/tools/webfetch"
	"github.com/floegence/floret/v7/tools/websearch"
	aitools "github.com/floegence/redeven/internal/ai/tools"
	"github.com/floegence/redeven/internal/config"
)

const webToolBindingAnnotation = "redeven_web_binding"

// The canonical first-provider surface owns non-secret service selection for a Turn.
// Credentials remain live host authorization and are never checkpointed.
type webToolBinding struct {
	Source              string `json:"source"`
	ProviderID          string `json:"provider_id,omitempty"`
	EndpointFingerprint string `json:"endpoint_fingerprint,omitempty"`
}

func webEndpointFingerprint(baseURL string) string {
	return fmt.Sprintf("%x", sha256.Sum256([]byte(strings.TrimRight(strings.TrimSpace(baseURL), "/"))))
}

func (r *run) bindWebTools(p config.AIProvider) {
	r.webToolBindings = map[string]webToolBinding{webfetch.ToolName: {Source: "direct"}}
	binding := webToolBinding{ProviderID: p.ID, EndpointFingerprint: webEndpointFingerprint(p.BaseURL)}
	r.webToolConnection = binding
	if p.WebFetchSource() == "deepseek" {
		binding.Source = "deepseek"
		r.webToolBindings[webfetch.ToolName] = binding
	}
	if r.webSearch.LocalTool() {
		binding.Source = "brave"
		if r.webSearch.Mode == config.AIWebSearchDeepSeek {
			binding.Source = "deepseek"
		}
		r.webToolBindings["web.search"] = binding
	}
}

func (r *run) frozenWebToolBindings(surface *flruntime.ProviderToolSurface) (map[string]webToolBinding, error) {
	if surface == nil {
		if r.webToolBindings == nil {
			return map[string]webToolBinding{"web_fetch": {Source: "direct"}}, nil
		}
		return r.webToolBindings, nil
	}
	bindings := map[string]webToolBinding{}
	for _, def := range surface.ToolDefinitions {
		if !isFloretNativeTool(def.Name) {
			continue
		}
		raw, ok := def.Annotations[webToolBindingAnnotation]
		var binding webToolBinding
		if ok {
			data, err := json.Marshal(raw)
			if err != nil {
				return nil, err
			}
			if err = json.Unmarshal(data, &binding); err != nil {
				return nil, err
			}
		} else {
			// These are the two published pre-binding tool contracts, not source fallbacks.
			properties, _ := def.InputSchema["properties"].(map[string]any)
			if def.Name == webfetch.ToolName && properties["format"] != nil && properties["url"] != nil {
				binding.Source = "direct"
			} else if def.Name == "web.search" && properties["provider"] != nil && properties["timeout_ms"] != nil {
				binding = r.webToolConnection
				binding.Source = "brave"
			} else {
				return nil, fmt.Errorf("unrecognized saved web tool %q", def.Name)
			}
		}
		if binding.Source != "direct" && binding.Source != "brave" && binding.Source != "deepseek" {
			return nil, errors.New("invalid saved web tool source")
		}
		if def.Name == "web.search" && binding.Source == "direct" || def.Name == webfetch.ToolName && binding.Source == "brave" {
			return nil, errors.New("invalid saved web tool binding")
		}
		if binding.Source != "direct" && (binding.ProviderID == "" || binding.EndpointFingerprint == "") {
			return nil, errors.New("incomplete saved web connection")
		}
		bindings[def.Name] = binding
	}
	return bindings, nil
}

// Resolve credentials immediately before dispatch, preserving key rotation and
// rejecting deleted, disabled, or readdressed connections without substitution.
func (r *run) webCredential(binding webToolBinding) func(context.Context) (string, error) {
	return func(ctx context.Context) (string, error) {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		p, err := r.currentWebProvider(binding)
		if err != nil {
			return "", err
		}
		resolve := r.resolveProviderKey
		if binding.Source == "brave" {
			resolve = r.resolveWebSearchKey
		}
		if resolve == nil {
			return "", errors.New("web service credential is unavailable; update the connection in Settings")
		}
		key, ok, err := resolve(p.ID)
		if err != nil || !ok || strings.TrimSpace(key) == "" {
			return "", errors.New("web service credential is unavailable; update the connection in Settings")
		}
		return strings.TrimSpace(key), nil
	}
}
func (r *run) currentWebProvider(binding webToolBinding) (config.AIProvider, error) {
	var p config.AIProvider
	var ok bool
	if r.host.webProvider != nil {
		p, ok = r.host.webProvider(binding.ProviderID)
	} else if r.cfg != nil {
		for _, candidate := range r.cfg.Providers {
			if candidate.ID == binding.ProviderID {
				p, ok = candidate, true
				break
			}
		}
	}
	if !ok || !p.IsEnabled() || webEndpointFingerprint(p.BaseURL) != binding.EndpointFingerprint || binding.Source == "deepseek" && p.Type != "deepseek" || binding.Source == "brave" && p.Type != "openai_compatible" {
		return config.AIProvider{}, errors.New("bound web connection changed or is unavailable; update Settings and start a new Turn")
	}
	return p, nil
}

func nativeWebTool(r *run, name string, binding webToolBinding, snapshot PermissionSnapshot) (fltools.Tool, error) {
	permission := fltools.PermissionSpec{Mode: fltools.PermissionAsk, ResourceKinds: []string{"web_url"}}
	if name == "web.search" {
		permission.ResourceKinds = []string{"search_query"}
	}
	resolve := func(request fltools.PermissionRequest) (fltools.PermissionSpec, error) {
		// Released pending Brave invocations may still carry their old provider field.
		// It must never select a different service or be silently ignored.
		if name == "web.search" {
			var args struct {
				Provider string `json:"provider"`
			}
			if err := json.Unmarshal([]byte(request.RawArgs), &args); err != nil {
				return fltools.PermissionSpec{}, err
			}
			if selected := strings.ToLower(strings.TrimSpace(args.Provider)); selected != "" && selected != binding.Source {
				return fltools.PermissionSpec{}, errors.New("search provider does not match the bound connection")
			}
		}
		def := nativeWebToolDefinition(name, binding)
		return fltools.PermissionSpec{Mode: floretPermissionMode(permissionDecisionForTool(snapshot.PermissionType, def)), ResourceKinds: permission.ResourceKinds}, nil
	}
	if name == webfetch.ToolName {
		options := webfetch.Options{Permission: permission, PermissionFor: resolve, AllowResolvedBenchmarkIPs: true}
		if binding.Source != "deepseek" {
			return webfetch.New(options), nil
		}
		p, _ := r.currentWebProvider(binding)
		return webfetch.NewDeepSeek(webfetch.DeepSeekOptions{Options: options, BaseURL: p.BaseURL, ResolveAPIKey: r.webCredential(binding)})
	}
	options := websearch.ClientOptions{APIKey: "host-resolved-at-dispatch"}
	if r != nil {
		p, _ := r.currentWebProvider(binding)
		options.APIKey = ""
		options.ResolveAPIKey = r.webCredential(binding)
		if binding.Source == "deepseek" {
			options.BaseURL = p.BaseURL
		}
	}
	var client *websearch.Client
	var err error
	if binding.Source == "deepseek" {
		client, err = websearch.NewDeepSeekClient(options)
	} else {
		client, err = websearch.NewBraveClient(options)
	}
	if err != nil {
		return fltools.Tool{}, err
	}
	return websearch.NewTool(client, websearch.ToolOptions{Name: "web.search", Permission: permission, PermissionFor: resolve}), nil
}

func nativeWebToolDefinition(name string, binding webToolBinding) ToolDef {
	var definition fltools.Definition
	if name == webfetch.ToolName {
		if binding.Source == "deepseek" {
			tool, _ := webfetch.NewDeepSeek(webfetch.DeepSeekOptions{APIKey: "schema-only"})
			definition = tool.Definition
		} else {
			definition = webfetch.New(webfetch.Options{}).Definition
		}
	} else {
		tool, _ := nativeWebTool(nil, name, binding, PermissionSnapshot{})
		definition = tool.Definition
	}
	return ToolDef{Name: definition.Name, Description: definition.Description, InputSchema: toolSchemaRaw(definition.InputSchema), Mutating: definition.Destructive, Visibility: ToolVisibilitySharedReadonly, Capabilities: []ToolCapabilityClass{ToolCapabilityReadonlyNetwork, ToolCapabilityOpenWorld}, Presentation: aitools.MustPresentationSpec(definition.Name), Source: "floret", Namespace: "floret.web", Priority: 100}
}
func floretNativeToolDefinitions() []ToolDef {
	return []ToolDef{nativeWebToolDefinition(webfetch.ToolName, webToolBinding{Source: "direct"}), nativeWebToolDefinition("web.search", webToolBinding{Source: "brave"})}
}
func (r *run) buildBoundNativeTool(def ToolDef, snapshot PermissionSnapshot, bindings map[string]webToolBinding) (fltools.Tool, error) {
	binding, ok := bindings[def.Name]
	if !ok {
		return fltools.Tool{}, errors.New("web tool is absent from the frozen Turn surface")
	}
	tool, err := nativeWebTool(r, def.Name, binding, snapshot)
	if err != nil {
		return fltools.Tool{}, err
	}
	var schema map[string]any
	if err = json.Unmarshal(def.InputSchema, &schema); err != nil {
		return fltools.Tool{}, err
	}
	tool.Definition.InputSchema = schema
	metadata := map[string]any{"source": binding.Source}
	if binding.ProviderID != "" {
		metadata["provider_id"] = binding.ProviderID
	}
	if binding.EndpointFingerprint != "" {
		metadata["endpoint_fingerprint"] = binding.EndpointFingerprint
	}
	tool.Definition.Annotations = map[string]any{"source": def.Source, "namespace": def.Namespace, webToolBindingAnnotation: metadata}
	return tool, nil
}
func isFloretNativeTool(name string) bool { return name == webfetch.ToolName || name == "web.search" }
