package automation

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/floegence/redevplugin/v3/pkg/capability"
)

// PluginWork retains an exact platform-issued binding, never a plugin-provided
// identity. The workflow is a visible authorization request, not an auto-grant.
type PluginWork struct {
	Binding     capability.ExecutionBinding `json:"-"`
	WorkID      string                      `json:"work_id"`
	RequestID   string                      `json:"request_id"`
	PayloadHash string                      `json:"-"`
}

func PluginRequestKey(b capability.ExecutionBinding, work, request string) string {
	return stableID("plugin_", b.PluginInstanceID, b.OwnerUserHash, b.OwnerEnvHash, work, request)
}
func (s *Store) CreatePluginRequest(ctx context.Context, o Owner, b capability.ExecutionBinding, work, request, instruction, material, dir string) (Workflow, error) {
	if b.RouteKind != capability.RouteCapability || b.CapabilityID != "agent.work" || b.PluginInstanceID == "" || b.OwnerUserHash == "" || b.OwnerEnvHash == "" || b.Quota.ExpiresAt.IsZero() || capability.ValidateExecutionBinding(b) != nil || work == "" || request == "" || instruction == "" || len(instruction) > 16000 || len(material) > 64000 || material != "" && !json.Valid([]byte(material)) {
		return Workflow{}, ErrInvalid
	}
	key := PluginRequestKey(b, work, request)
	hash := stableID("", instruction, material)
	if existing, e := s.PluginRequest(ctx, o, b, work, request); e == nil {
		if existing.Plugin.PayloadHash != hash {
			return Workflow{}, ErrConflict
		}
		return existing, nil
	} else if !errors.Is(e, ErrNotFound) {
		return Workflow{}, e
	}

	d := Definition{Title: work, Goal: instruction, WorkingDirectory: dir, MaxConcurrent: 1, TimeoutSeconds: 1800, Nodes: []Node{{ID: "analyze", Title: work, Kind: "agent", Instruction: instruction, Parameters: json.RawMessage(material), OutputSchema: json.RawMessage(`{"type":"object"}`)}}}
	return s.create(ctx, o, key, d, &PluginWork{Binding: b, WorkID: work, RequestID: request, PayloadHash: hash})
}

func (s *Store) PluginRequest(ctx context.Context, o Owner, b capability.ExecutionBinding, work, request string) (Workflow, error) {
	w, err := s.Get(ctx, o, stableID("flow_", o.User, o.Environment, PluginRequestKey(b, work, request)))
	if err != nil {
		return w, err
	}
	if w.Plugin == nil || w.Plugin.Binding.PluginInstanceID != b.PluginInstanceID || w.Plugin.Binding.ActiveFingerprint != b.ActiveFingerprint {
		return Workflow{}, ErrNotFound
	}
	return w, nil
}
func (s *Store) PluginRun(ctx context.Context, o Owner, w Workflow) (Run, error) {
	if w.Plugin == nil {
		return Run{}, ErrInvalid
	}
	rows, err := s.Runs(ctx, o, w.ID)
	if err != nil {
		return Run{}, err
	}
	if len(rows) == 0 {
		return Run{}, ErrNotFound
	}
	return rows[0], nil
}
func pluginDeadline(w Workflow) time.Time {
	if w.Plugin == nil {
		return time.Time{}
	}
	return w.Plugin.Binding.Quota.ExpiresAt
}
func (w Workflow) validatePluginPublication(g Grant) error {
	if w.Plugin == nil {
		return nil
	}
	if len(g.Tools) != 0 || !pluginDeadline(w).After(time.Now()) {
		return fmt.Errorf("%w: plugin work accepts provided material only and requires a live original grant", ErrUnauthorized)
	}
	return nil
}

func encodeWorkflow(w Workflow) string {
	type persisted struct {
		Workflow
		PluginBinding *capability.ExecutionBinding `json:"plugin_binding,omitempty"`
		PluginHash    string                       `json:"plugin_payload_hash,omitempty"`
	}
	value := persisted{Workflow: w}
	if w.Plugin != nil {
		value.PluginBinding = &w.Plugin.Binding
		value.PluginHash = w.Plugin.PayloadHash
	}
	raw, _ := json.Marshal(value)
	return string(raw)
}
func restoreWorkflowPrivate(raw string, w *Workflow) error {
	var value struct {
		PluginBinding *capability.ExecutionBinding `json:"plugin_binding"`
		PluginHash    string                       `json:"plugin_payload_hash"`
	}
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return err
	}
	if w.Plugin != nil {
		if value.PluginBinding == nil {
			return ErrInvalid
		}
		w.Plugin.Binding = *value.PluginBinding
		w.Plugin.PayloadHash = value.PluginHash
	}
	return nil
}
func (s *Store) SetPluginValidator(validate func(context.Context, capability.ExecutionBinding) error) {
	s.pluginMu.Lock()
	s.pluginValidate = validate
	s.pluginMu.Unlock()
}
func (s *Store) ValidatePluginAuthority(ctx context.Context, o Owner, id string) error {
	w, err := s.Get(ctx, o, id)
	if err != nil {
		return err
	}
	if w.Plugin == nil {
		return nil
	}
	s.pluginMu.RLock()
	validate := s.pluginValidate
	s.pluginMu.RUnlock()
	if validate == nil {
		return ErrUnauthorized
	}
	return validate(ctx, w.Plugin.Binding)
}
