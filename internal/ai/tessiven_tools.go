package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"

	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/tessiven"
)

func builtInTessivenToolDefinitions() []ToolDef {
	str := func(description string) map[string]any {
		return map[string]any{"type": "string", "description": description}
	}
	text := map[string]any{"type": "string"}
	integer := map[string]any{"type": "integer", "minimum": 1}
	defs := []ToolDef{}
	add := func(name, description string, properties map[string]any, required []string, mutating bool) {
		visibility := ToolVisibilitySharedReadonly
		capabilities := []ToolCapabilityClass{ToolCapabilityReadonlyLocal}
		if mutating {
			visibility = ToolVisibilityStandard
			capabilities = []ToolCapabilityClass{ToolCapabilityMutation}
		}
		defs = append(defs, ToolDef{Name: name, Description: description, InputSchema: toolSchemaRaw(map[string]any{"type": "object", "properties": properties, "required": required, "additionalProperties": false}), Mutating: mutating, RequiresApproval: mutating, Visibility: visibility, Capabilities: capabilities, Source: "builtin", Namespace: "builtin.tessiven", Priority: 100})
	}
	add("tessiven.runtimes", "Discover registered Runtime paths on the Desktop device and Flower execution machine without starting a process or session.", map[string]any{}, []string{}, false)
	runtimeProperties := map[string]any{"runtime_ref": str("Exact runtime_ref returned by discovery"), "generation": str("Exact observed path generation"), "identity": str("Verified identity returned by discovery; omit when unverified"), "operation_id": str("Original Desktop owner operation ID")}
	inspectProperties := map[string]any{}
	for key, value := range runtimeProperties {
		inspectProperties[key] = value
	}
	inspectProperties["action"] = map[string]any{"type": "string", "enum": []string{"status", "diagnose", "operation"}}
	add("tessiven.runtime.inspect", "Inspect a registered Runtime path or query the original Desktop operation.", inspectProperties, []string{"runtime_ref", "generation", "action"}, false)
	actionProperties := map[string]any{}
	for key, value := range runtimeProperties {
		actionProperties[key] = value
	}
	actionProperties["action"] = map[string]any{"type": "string", "enum": []string{"connect", "start", "stop", "restart", "update"}}
	actionProperties["request_id"] = str("Unique request ID; never replay after unknown outcome")
	add("tessiven.runtime.action", "Connect/authenticate or manage a Runtime process through Desktop. Gateway paths allow business access only. handoff_required means native confirmation is pending; no lifecycle action has started. Desktop handles workload confirmation, cancellation and release selection.", actionProperties, []string{"runtime_ref", "generation", "action", "request_id"}, true)
	add("tessiven.schema", "Read the Tessiven DSL JSON Schema. Omit version for current or supply a supported stored dsl_version.", map[string]any{"version": str("Exact supported DSL version, such as v1.0.0; omit for current")}, []string{}, false)
	add("tessiven.list", "List business canvases in the local Runtime library. Follow next_cursor for more results.", map[string]any{"query": str("Title or description search"), "cursor": str("Opaque next_cursor"), "archived": map[string]any{"type": "boolean"}}, []string{}, false)
	add("tessiven.read", "Read immutable canvas YAML. Defaults: latest version, line 1, 200 lines; maximum 64 KiB. Continue at end_line + 1 while has_more. Repair historical placement diagnostics before editing.", map[string]any{"canvas_id": text, "version": integer, "start_line": integer, "line_count": map[string]any{"type": "integer", "minimum": 1, "maximum": 500}}, []string{"canvas_id"}, false)
	add("tessiven.search", "Search literal text in an immutable canvas version. Continue at next_line; pin the returned version for subsequent reads and edits.", map[string]any{"canvas_id": text, "version": integer, "query": str("Literal single-line text, object ID or name"), "start_line": integer, "limit": map[string]any{"type": "integer", "minimum": 1, "maximum": 50}}, []string{"canvas_id", "query"}, false)
	add("tessiven.edit", "Apply ordered exact replacements to an existing canvas; each old_string must match once. Validates and saves one version atomically; preserves untouched YAML except reviewed DSL upgrades. expected_version is the version read. Retry uncertain results with identical request_id and arguments; reread on version conflict.", map[string]any{"request_id": str("Unique stable request ID"), "canvas_id": text, "expected_version": map[string]any{"type": "integer", "minimum": 1}, "summary": text, "edits": map[string]any{"type": "array", "minItems": 1, "maxItems": 50, "items": map[string]any{"type": "object", "properties": map[string]any{"old_string": str("Exact nonempty text read from the base YAML"), "new_string": str("Replacement text; empty deletes")}, "required": []string{"old_string", "new_string"}, "additionalProperties": false}}}, []string{"request_id", "canvas_id", "expected_version", "summary", "edits"}, true)
	add("tessiven.versions", "List saved versions newest first; continue with before equal to the last number when 100 results are returned.", map[string]any{"canvas_id": text, "before": integer}, []string{"canvas_id"}, false)
	add("tessiven.validate", "Validate YAML without saving; returns locations and reasons for invalid fields or references.", map[string]any{"document_yaml": text}, []string{"document_yaml"}, false)
	add("tessiven.save", "Save a complete new immutable version. Omit canvas_id and use expected_version 0 to create a canvas. Preserve object IDs on updates. Reuse the exact request_id and payload for an uncertain network retry; read again on version conflict.", map[string]any{"request_id": str("Unique stable request ID"), "canvas_id": str("Existing canvas ID; omit to create"), "expected_version": map[string]any{"type": "integer", "minimum": 0}, "document_yaml": text, "summary": text}, []string{"request_id", "expected_version", "document_yaml", "summary"}, true)
	binding := map[string]any{"type": "object", "properties": map[string]any{"owner": map[string]any{"type": "string", "enum": []string{"managed_service", "container"}}, "resourceId": str("Exact ID from inspection"), "engine": map[string]any{"type": "string", "enum": []string{"docker", "podman"}}, "endpointId": str("Actual container endpoint"), "identity": str("Stable observed resource identity")}, "required": []string{"owner", "resourceId"}, "additionalProperties": false}
	add("tessiven.inspect", "Inspect a connected Runtime or resource. Use local:local for the current Runtime and discovered bindings; canvas labels are not connection refs. No local fallback for unavailable targets. list returns bindings; inspect uses immutable canvas/version/instance refs; operation queries the original manager. Unavailable targets return structured unavailable state.", map[string]any{"runtime_ref": str("Connected Runtime ref."), "action": map[string]any{"type": "string", "enum": []string{"list", "inspect", "logs", "operation"}}, "binding": binding, "canvas_id": text, "version_id": integer, "instance_id": text, "operation_id": str("Original manager operation ID")}, []string{"runtime_ref", "action"}, false)
	add("tessiven.action", "Act on one bound service instance in the latest nonarchived canvas. Inspect first and use its identity. Unavailable or unbound Runtime refs, canvas labels, history, groups and logical services are not execution targets.", map[string]any{"canvas_id": text, "version_id": integer, "instance_id": text, "runtime_ref": str("Actual authorized target reference"), "generation": str("Observed connection generation returned by remote inspection; required for remote actions"), "action": map[string]any{"type": "string", "enum": []string{"open", "start", "stop", "restart"}}, "request_id": str("Unique request ID; never repeat an action after an unknown outcome"), "identity": str("Identity returned by current inspection")}, []string{"canvas_id", "version_id", "instance_id", "runtime_ref", "action", "request_id", "identity"}, true)
	return defs
}

func decodeTessivenToolArgs(args map[string]any, out any) error {
	raw, err := json.Marshal(args)
	if err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	return decoder.Decode(out)
}
func (r *run) execTessivenTool(ctx context.Context, meta *session.Meta, name string, args map[string]any) (any, error) {
	if meta == nil || !meta.CanRead {
		return nil, tessiven.ErrPermissionDenied
	}
	library := r.host.tessiven
	if library == nil {
		return nil, errors.New("tessiven is unavailable")
	}
	switch name {
	case "tessiven.runtimes":
		if len(args) != 0 {
			return nil, tessiven.ErrInvalidRequest
		}
		if r.host.tessivenResources == nil {
			return nil, tessiven.ErrTargetUnavailable
		}
		return r.host.tessivenResources.Runtimes(ctx, meta)
	case "tessiven.runtime.inspect", "tessiven.runtime.action":
		var req tessiven.RuntimeRequest
		if err := decodeTessivenToolArgs(args, &req); err != nil {
			return nil, err
		}
		mutation := req.Action == "connect" || req.Action == "start" || req.Action == "stop" || req.Action == "restart" || req.Action == "update"
		if mutation != (name == "tessiven.runtime.action") {
			return nil, tessiven.ErrInvalidRequest
		}
		if r.host.tessivenResources == nil {
			return nil, tessiven.ErrTargetUnavailable
		}
		return r.host.tessivenResources.Runtime(ctx, meta, req)
	case "tessiven.schema":
		var p struct {
			Version string `json:"version"`
		}
		if err := decodeTessivenToolArgs(args, &p); err != nil {
			return nil, err
		}
		return tessiven.SchemaForVersion(p.Version)
	case "tessiven.list":
		var p struct {
			Query    string `json:"query"`
			Cursor   string `json:"cursor"`
			Archived bool   `json:"archived"`
		}
		if err := decodeTessivenToolArgs(args, &p); err != nil {
			return nil, err
		}
		return library.List(ctx, p.Query, p.Cursor, p.Archived)
	case "tessiven.read":
		var p tessiven.ReadRequest
		if err := decodeTessivenToolArgs(args, &p); err != nil {
			return nil, err
		}
		return library.Read(ctx, p)
	case "tessiven.search":
		var p tessiven.SearchRequest
		if err := decodeTessivenToolArgs(args, &p); err != nil {
			return nil, err
		}
		return library.Search(ctx, p)
	case "tessiven.edit":
		if !meta.CanWrite {
			return nil, tessiven.ErrPermissionDenied
		}
		var p tessiven.EditRequest
		if err := decodeTessivenToolArgs(args, &p); err != nil {
			return nil, err
		}
		result, err := library.Edit(ctx, p)
		if err != nil {
			return nil, err
		}
		return tessivenToolSaveResult(result), nil
	case "tessiven.versions":
		var p struct {
			CanvasID string `json:"canvas_id"`
			Before   int64  `json:"before"`
		}
		if err := decodeTessivenToolArgs(args, &p); err != nil {
			return nil, err
		}
		if p.CanvasID == "" || p.Before < 0 {
			return nil, tessiven.ErrInvalidRequest
		}
		return library.Versions(ctx, p.CanvasID, p.Before)
	case "tessiven.validate":
		var p struct {
			DocumentYAML string `json:"document_yaml"`
		}
		if err := decodeTessivenToolArgs(args, &p); err != nil {
			return nil, err
		}
		validation := tessiven.Validate(p.DocumentYAML)
		validation.Document = nil // The model already has the input; do not echo the full graph.
		return validation, nil
	case "tessiven.save":
		if !meta.CanWrite {
			return nil, tessiven.ErrPermissionDenied
		}
		var p tessiven.SaveRequest
		if err := decodeTessivenToolArgs(args, &p); err != nil {
			return nil, err
		}
		result, err := library.Save(ctx, p, "flower")
		if err != nil {
			return nil, err
		}
		return tessivenToolSaveResult(result), nil
	case "tessiven.inspect", "tessiven.action":
		var p tessiven.ResourceRequest
		if err := decodeTessivenToolArgs(args, &p); err != nil {
			return nil, err
		}
		mutation := p.Action == "open" || p.Action == "start" || p.Action == "stop" || p.Action == "restart"
		if mutation != (name == "tessiven.action") {
			return nil, tessiven.ErrInvalidRequest
		}
		if r.host.tessivenResources == nil {
			return nil, tessiven.ErrTargetUnavailable
		}
		return r.host.tessivenResources.Execute(ctx, meta, p)
	default:
		return nil, errors.New("unknown Tessiven tool: " + strings.TrimSpace(name))
	}
}

func tessivenToolSaveResult(result tessiven.SaveResult) map[string]any {
	return map[string]any{"canvas": result.Canvas, "title": result.Canvas.Title, "version": result.Version.Number, "dsl_version": result.Version.DSLVersion, "digest": result.Version.Digest, "summary": result.Version.Summary, "canvas_url": "/_redeven_proxy/env/?surface=tessiven&canvas=" + result.Canvas.ID + "&version=" + strconv.FormatInt(result.Version.Number, 10)}
}
