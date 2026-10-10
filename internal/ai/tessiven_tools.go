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
	add("tessiven.schema", "Read the exact Tessiven DSL JSON Schema. Omit version for the current schema; use a stored dsl_version to inspect a supported historical schema. Never relabel unknown versions.", map[string]any{"version": str("Exact supported DSL version, such as v1.0.0; omit for current")}, []string{}, false)
	add("tessiven.list", "List business canvases in the local Runtime library. Follow next_cursor for more results.", map[string]any{"query": str("Title or description search"), "cursor": str("Opaque next_cursor"), "archived": map[string]any{"type": "boolean"}}, []string{}, false)
	add("tessiven.read", "Read a bounded, literal YAML range from an immutable canvas version. Omit version for latest, start_line for 1 and line_count for 200 (maximum 500 lines / 65536 bytes). Returns exact version, title, digest and line bounds; continue at end_line + 1 while has_more. Use search to locate relevant objects. Stored historical placement diagnostics must be repaired before editing.", map[string]any{"canvas_id": str("Exact canvas ID"), "version": integer, "start_line": integer, "line_count": map[string]any{"type": "integer", "minimum": 1, "maximum": 500}}, []string{"canvas_id"}, false)
	add("tessiven.search", "Find literal text in one immutable canvas version without loading the whole document. Returns matching line numbers and excerpts; continue at next_line when supplied. Pin the returned version for subsequent reads and edits.", map[string]any{"canvas_id": str("Exact canvas ID"), "version": integer, "query": str("Literal single-line text, object ID or name"), "start_line": integer, "limit": map[string]any{"type": "integer", "minimum": 1, "maximum": 50}}, []string{"canvas_id", "query"}, false)
	add("tessiven.edit", "Edit an existing canvas with a small batch of exact text replacements, like a text Edit tool. Each old_string must match exactly once, in batch order; include surrounding YAML for ambiguity. The complete result is validated and saved atomically as one new version, preserving untouched text except a reviewed DSL version upgrade. expected_version must be the version read. Retry an uncertain result with the exact request_id and arguments; read again on version conflict. Prefer this tool to full save for existing canvases.", map[string]any{"request_id": str("Unique stable request ID"), "canvas_id": str("Exact existing canvas ID"), "expected_version": map[string]any{"type": "integer", "minimum": 1}, "summary": str("Concise change summary"), "edits": map[string]any{"type": "array", "minItems": 1, "maxItems": 50, "items": map[string]any{"type": "object", "properties": map[string]any{"old_string": str("Exact nonempty text read from the base YAML"), "new_string": str("Replacement text; empty deletes")}, "required": []string{"old_string", "new_string"}, "additionalProperties": false}}}, []string{"request_id", "canvas_id", "expected_version", "summary", "edits"}, true)
	add("tessiven.versions", "List saved versions newest first; continue with before equal to the last number when 100 results are returned.", map[string]any{"canvas_id": str("Exact canvas ID"), "before": integer}, []string{"canvas_id"}, false)
	add("tessiven.validate", "Validate YAML without changing saved data. Returns locations and reasons for invalid fields or references.", map[string]any{"document_yaml": str("Full YAML document")}, []string{"document_yaml"}, false)
	add("tessiven.save", "Save a complete new immutable version. Omit canvas_id and use expected_version 0 to create a canvas. Preserve object IDs on updates. Reuse the exact request_id and payload for an uncertain network retry; read again on version conflict.", map[string]any{"request_id": str("Unique stable request ID"), "canvas_id": str("Existing canvas ID; omit to create"), "expected_version": map[string]any{"type": "integer", "minimum": 0}, "document_yaml": str("Complete validated YAML document"), "summary": str("Concise change summary")}, []string{"request_id", "expected_version", "document_yaml", "summary"}, true)
	binding := map[string]any{"type": "object", "properties": map[string]any{"owner": map[string]any{"type": "string", "enum": []string{"managed_service", "container"}}, "resourceId": str("Exact ID from inspection"), "engine": map[string]any{"type": "string", "enum": []string{"docker", "podman"}}, "endpointId": str("Actual container endpoint"), "identity": str("Stable observed resource identity")}, "required": []string{"owner", "resourceId"}, "additionalProperties": false}
	add("tessiven.inspect", "Inspect an explicitly connected Runtime or a resource. Use local:local for the current Runtime; a canvas label such as demo:application is descriptive data, not a connection handle. Never guess bindings or substitute local results for unavailable remote targets. Read-only inspection of an unavailable target returns structured unavailable state; list returns actual bindings; inspect an instance through its immutable canvas/version reference. operation reads progress from the original manager.", map[string]any{"runtime_ref": str("Actual target reference, local:local for the current Runtime"), "action": map[string]any{"type": "string", "enum": []string{"list", "inspect", "logs", "operation"}}, "binding": binding, "canvas_id": str("Canvas ID"), "version_id": integer, "instance_id": str("Instance ID"), "operation_id": str("Original manager operation ID")}, []string{"runtime_ref", "action"}, false)
	add("tessiven.action", "Execute one supported action on one explicitly bound service instance in the latest nonarchived canvas. Inspect first and supply the returned identity. Existing service permissions and approvals apply. Unavailable, descriptive, or unbound Runtime references cannot be mutated. History, groups, and logical services cannot be execution targets.", map[string]any{"canvas_id": str("Canvas ID"), "version_id": integer, "instance_id": str("Exact instance ID"), "runtime_ref": str("Actual authorized target reference"), "action": map[string]any{"type": "string", "enum": []string{"open", "start", "stop", "restart"}}, "request_id": str("Unique request ID; never repeat an action after an unknown outcome"), "identity": str("Identity returned by current inspection")}, []string{"canvas_id", "version_id", "instance_id", "runtime_ref", "action", "request_id", "identity"}, true)
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
