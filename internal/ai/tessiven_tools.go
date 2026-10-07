package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
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
	add("tessiven.schema", "Read the authoritative Tessiven YAML document JSON Schema. Use before creating or updating a canvas.", map[string]any{}, []string{}, false)
	add("tessiven.list", "List business canvases in the local Runtime library. Follow next_cursor for more results.", map[string]any{"query": str("Title or description search"), "cursor": str("Opaque next_cursor"), "archived": map[string]any{"type": "boolean"}}, []string{}, false)
	add("tessiven.read", "Read an immutable canvas version, including YAML and resolved document. Omit version for the latest version.", map[string]any{"canvas_id": str("Exact canvas ID"), "version": integer}, []string{"canvas_id"}, false)
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
		if len(args) != 0 {
			return nil, tessiven.ErrInvalidRequest
		}
		return tessiven.Schema(), nil
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
	case "tessiven.read", "tessiven.versions":
		var p struct {
			CanvasID string `json:"canvas_id"`
			Version  int64  `json:"version"`
			Before   int64  `json:"before"`
		}
		if err := decodeTessivenToolArgs(args, &p); err != nil {
			return nil, err
		}
		if (name == "tessiven.read" && args["before"] != nil) || (name == "tessiven.versions" && args["version"] != nil) || p.CanvasID == "" || p.Version < 0 || p.Before < 0 {
			return nil, tessiven.ErrInvalidRequest
		}
		if name == "tessiven.read" {
			return library.Version(ctx, p.CanvasID, p.Version)
		}
		return library.Versions(ctx, p.CanvasID, p.Before)
	case "tessiven.validate":
		var p struct {
			DocumentYAML string `json:"document_yaml"`
		}
		if err := decodeTessivenToolArgs(args, &p); err != nil {
			return nil, err
		}
		return tessiven.Validate(p.DocumentYAML), nil
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
		return map[string]any{"canvas": result.Canvas, "version": result.Version.Number, "digest": result.Version.Digest, "summary": result.Version.Summary, "canvas_url": "/_redeven_proxy/env/?surface=tessiven&canvas=" + result.Canvas.ID + "&version=" + anyToString(result.Version.Number)}, nil
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
