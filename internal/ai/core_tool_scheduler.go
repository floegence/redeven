package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"sync"

	aitools "github.com/floegence/redeven-agent/internal/ai/tools"
)

const (
	toolResultStatusSuccess = "success"
	toolResultStatusError   = "error"
	toolResultStatusAborted = "aborted"
	toolResultStatusTimeout = "timeout"
)

var sourceRank = map[string]int{
	"builtin":  4,
	"mcp":      3,
	"skill":    2,
	"subagent": 1,
}

type registeredTool struct {
	def     ToolDef
	handler ToolHandler
}

type toolResolver interface {
	ToolRegistry
	resolve(name string) (ToolDef, ToolHandler, bool)
}

type InMemoryToolRegistry struct {
	mu    sync.RWMutex
	tools map[string]registeredTool
}

func NewInMemoryToolRegistry() *InMemoryToolRegistry {
	return &InMemoryToolRegistry{tools: make(map[string]registeredTool)}
}

func (r *InMemoryToolRegistry) Register(tool ToolDef, handler ToolHandler) error {
	if r == nil {
		return errors.New("nil tool registry")
	}
	name := strings.TrimSpace(tool.Name)
	if name == "" {
		return errors.New("tool name is required")
	}
	if handler == nil {
		return fmt.Errorf("tool %s missing handler", name)
	}
	tool.Name = name
	tool.Source = strings.ToLower(strings.TrimSpace(tool.Source))
	if tool.Source == "" {
		tool.Source = "builtin"
	}
	if tool.Namespace == "" {
		tool.Namespace = "builtin"
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if existing, ok := r.tools[name]; ok {
		replace, err := shouldReplaceTool(existing.def, tool)
		if err != nil {
			return err
		}
		if !replace {
			return nil
		}
	}
	r.tools[name] = registeredTool{def: tool, handler: handler}
	return nil
}

func shouldReplaceTool(existing ToolDef, candidate ToolDef) (bool, error) {
	if candidate.Priority > existing.Priority {
		return true, nil
	}
	if candidate.Priority < existing.Priority {
		return false, nil
	}
	existingRank := sourceRank[strings.ToLower(strings.TrimSpace(existing.Source))]
	candidateRank := sourceRank[strings.ToLower(strings.TrimSpace(candidate.Source))]
	if candidateRank > existingRank {
		return true, nil
	}
	if candidateRank < existingRank {
		return false, nil
	}
	return false, fmt.Errorf("tool_registry_conflict: duplicate tool %q with same priority/source", existing.Name)
}

func (r *InMemoryToolRegistry) Unregister(name string) error {
	if r == nil {
		return errors.New("nil tool registry")
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return errors.New("tool name is required")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.tools, name)
	return nil
}

func (r *InMemoryToolRegistry) Snapshot() []ToolDef {
	if r == nil {
		return nil
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]ToolDef, 0, len(r.tools))
	for _, item := range r.tools {
		out = append(out, item.def)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Priority == out[j].Priority {
			return out[i].Name < out[j].Name
		}
		return out[i].Priority > out[j].Priority
	})
	return out
}

func (r *InMemoryToolRegistry) resolve(name string) (ToolDef, ToolHandler, bool) {
	if r == nil {
		return ToolDef{}, nil, false
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return ToolDef{}, nil, false
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	item, ok := r.tools[name]
	if !ok {
		return ToolDef{}, nil, false
	}
	return item.def, item.handler, true
}

type DefaultModeToolFilter struct{}

func (f DefaultModeToolFilter) FilterToolsForMode(mode string, all []ToolDef) []ToolDef {
	mode = strings.ToLower(strings.TrimSpace(mode))
	if mode == "" {
		mode = "act"
	}
	out := make([]ToolDef, 0, len(all))
	for _, tool := range all {
		if mode == "plan" && tool.Mutating {
			continue
		}
		out = append(out, tool)
	}
	return out
}

type CoreToolScheduler struct {
	registry     toolResolver
	interceptors []ToolInterceptor
	modeFilter   ModeToolFilter
	parallelism  int
}

func NewCoreToolScheduler(reg ToolRegistry, modeFilter ModeToolFilter, interceptors ...ToolInterceptor) (*CoreToolScheduler, error) {
	resolver, ok := reg.(toolResolver)
	if !ok {
		return nil, errors.New("tool registry does not support resolve")
	}
	if modeFilter == nil {
		modeFilter = DefaultModeToolFilter{}
	}
	parallelism := 2
	return &CoreToolScheduler{
		registry:     resolver,
		interceptors: append([]ToolInterceptor(nil), interceptors...),
		modeFilter:   modeFilter,
		parallelism:  parallelism,
	}, nil
}

func (s *CoreToolScheduler) ActiveTools(mode string) []ToolDef {
	if s == nil || s.registry == nil {
		return nil
	}
	all := s.registry.Snapshot()
	return s.modeFilter.FilterToolsForMode(mode, all)
}

func (s *CoreToolScheduler) HandlePartial(ctx context.Context, partial PartialToolCall) error {
	if s == nil || s.registry == nil {
		return errors.New("nil tool scheduler")
	}
	_, handler, ok := s.registry.resolve(strings.TrimSpace(partial.Name))
	if !ok {
		return fmt.Errorf("unknown tool %q", strings.TrimSpace(partial.Name))
	}
	return handler.HandlePartial(ctx, partial)
}

func (s *CoreToolScheduler) Dispatch(ctx context.Context, mode string, calls []ToolCall) []ToolResult {
	if s == nil || s.registry == nil {
		return []ToolResult{{Status: toolResultStatusError, Summary: "tool.scheduler_error", Details: "tool scheduler unavailable"}}
	}
	if len(calls) == 0 {
		return nil
	}
	active := s.ActiveTools(mode)
	activeSet := make(map[string]ToolDef, len(active))
	for _, def := range active {
		activeSet[strings.TrimSpace(def.Name)] = def
	}

	type dispatchItem struct {
		index   int
		call    ToolCall
		def     ToolDef
		handler ToolHandler
	}
	results := make([]ToolResult, len(calls))
	parallelItems := make([]dispatchItem, 0, len(calls))
	serialItems := make([]dispatchItem, 0, len(calls))

	for idx, call := range calls {
		call.Name = strings.TrimSpace(call.Name)
		if call.Name == "" {
			results[idx] = ToolResult{ToolID: call.ID, Status: toolResultStatusError, Summary: "tool.argument_error", Details: "missing tool name"}
			continue
		}
		def, ok := activeSet[call.Name]
		if !ok {
			results[idx] = ToolResult{ToolID: call.ID, ToolName: call.Name, Status: toolResultStatusError, Summary: "tool.argument_error", Details: fmt.Sprintf("unknown or disabled tool: %s", call.Name)}
			continue
		}
		_, handler, ok := s.registry.resolve(call.Name)
		if !ok || handler == nil {
			results[idx] = ToolResult{ToolID: call.ID, ToolName: call.Name, Status: toolResultStatusError, Summary: "tool.argument_error", Details: fmt.Sprintf("tool handler missing: %s", call.Name)}
			continue
		}
		if err := validateToolArgs(def, call.Args); err != nil {
			results[idx] = ToolResult{ToolID: call.ID, ToolName: call.Name, Status: toolResultStatusError, Summary: "tool.argument_error", Details: err.Error()}
			continue
		}
		if err := handler.Validate(ctx, call); err != nil {
			results[idx] = ToolResult{ToolID: call.ID, ToolName: call.Name, Status: toolResultStatusError, Summary: "tool.argument_error", Details: err.Error()}
			continue
		}
		item := dispatchItem{index: idx, call: call, def: def, handler: handler}
		if def.ParallelSafe && !def.Mutating {
			parallelItems = append(parallelItems, item)
		} else {
			serialItems = append(serialItems, item)
		}
	}

	runItem := func(item dispatchItem) {
		results[item.index] = s.executeOne(ctx, item.call, item.def, item.handler)
	}

	if len(parallelItems) > 0 {
		limit := s.parallelism
		if limit <= 0 {
			limit = 2
		}
		sem := make(chan struct{}, limit)
		var wg sync.WaitGroup
		for _, item := range parallelItems {
			item := item
			wg.Add(1)
			go func() {
				defer wg.Done()
				select {
				case sem <- struct{}{}:
					defer func() { <-sem }()
					runItem(item)
				case <-ctx.Done():
					results[item.index] = ToolResult{ToolID: item.call.ID, ToolName: item.call.Name, Status: toolResultStatusAborted, Summary: "tool.aborted", Details: "tool execution canceled"}
				}
			}()
		}
		wg.Wait()
	}

	for _, item := range serialItems {
		runItem(item)
	}

	for i, result := range results {
		if strings.TrimSpace(result.Status) == "" {
			results[i] = ToolResult{ToolID: calls[i].ID, ToolName: calls[i].Name, Status: toolResultStatusAborted, Summary: "tool.aborted", Details: "tool not dispatched"}
		}
	}
	return results
}

func (s *CoreToolScheduler) executeOne(ctx context.Context, call ToolCall, def ToolDef, handler ToolHandler) ToolResult {
	if err := ctx.Err(); err != nil {
		return ToolResult{ToolID: call.ID, ToolName: call.Name, Status: toolResultStatusAborted, Summary: "tool.aborted", Details: err.Error()}
	}
	patched := call
	for _, interceptor := range s.interceptors {
		if interceptor == nil {
			continue
		}
		nextCall, err := interceptor.BeforeExec(ctx, patched)
		if err != nil {
			return ToolResult{ToolID: call.ID, ToolName: call.Name, Status: toolResultStatusError, Summary: "tool.before_exec_error", Details: err.Error()}
		}
		patched = nextCall
	}

	result, err := handler.Execute(ctx, patched)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return ToolResult{ToolID: call.ID, ToolName: call.Name, Status: toolResultStatusAborted, Summary: "tool.aborted", Details: "tool execution canceled"}
		}
		if errors.Is(err, context.DeadlineExceeded) {
			return ToolResult{ToolID: call.ID, ToolName: call.Name, Status: toolResultStatusTimeout, Summary: "tool.timeout", Details: "tool execution timed out"}
		}
		toolErr := aitools.ClassifyError(aitools.Invocation{ToolName: call.Name, Args: call.Args}, err)
		if toolErr != nil {
			return ToolResult{ToolID: call.ID, ToolName: call.Name, Status: toolResultStatusError, Summary: "tool.error", Details: toolErr.Message, Error: toolErr}
		}
		return ToolResult{ToolID: call.ID, ToolName: call.Name, Status: toolResultStatusError, Summary: "tool.error", Details: err.Error()}
	}

	result.ToolID = call.ID
	result.ToolName = call.Name
	if strings.TrimSpace(result.Status) == "" {
		result.Status = toolResultStatusSuccess
	}
	for _, interceptor := range s.interceptors {
		if interceptor == nil {
			continue
		}
		nextResult, err := interceptor.AfterExec(ctx, patched, result)
		if err != nil {
			return ToolResult{ToolID: call.ID, ToolName: call.Name, Status: toolResultStatusError, Summary: "tool.after_exec_error", Details: err.Error()}
		}
		result = nextResult
	}
	return result
}

func validateToolArgs(def ToolDef, args map[string]any) error {
	if len(def.InputSchema) == 0 {
		return nil
	}
	if args == nil {
		args = map[string]any{}
	}
	var schema map[string]any
	if err := json.Unmarshal(def.InputSchema, &schema); err != nil {
		return nil
	}
	if req, ok := schema["required"].([]any); ok {
		for _, item := range req {
			name, _ := item.(string)
			name = strings.TrimSpace(name)
			if name == "" {
				continue
			}
			if _, exists := args[name]; !exists {
				return fmt.Errorf("missing required field: %s", name)
			}
		}
	}
	properties, _ := schema["properties"].(map[string]any)
	for key, val := range args {
		propRaw, ok := properties[key]
		if !ok {
			continue
		}
		prop, _ := propRaw.(map[string]any)
		typeName, _ := prop["type"].(string)
		typeName = strings.TrimSpace(typeName)
		if typeName == "" {
			continue
		}
		if !matchesSchemaType(typeName, val) {
			return fmt.Errorf("invalid type for %s: expected %s", key, typeName)
		}
	}
	return nil
}

func matchesSchemaType(typeName string, v any) bool {
	typeName = strings.ToLower(strings.TrimSpace(typeName))
	switch typeName {
	case "string":
		_, ok := v.(string)
		return ok
	case "boolean":
		_, ok := v.(bool)
		return ok
	case "integer":
		switch v.(type) {
		case int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64, float64, float32:
			return true
		default:
			return false
		}
	case "number":
		switch v.(type) {
		case int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64, float64, float32:
			return true
		default:
			return false
		}
	case "object":
		return reflect.TypeOf(v) != nil && reflect.TypeOf(v).Kind() == reflect.Map
	case "array":
		kind := reflect.TypeOf(v)
		return kind != nil && (kind.Kind() == reflect.Slice || kind.Kind() == reflect.Array)
	default:
		return true
	}
}
