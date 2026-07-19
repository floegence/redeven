package redevpluginintegration

import (
	"context"
	"errors"

	"github.com/floegence/redeven/internal/auditlog"
	"github.com/floegence/redeven/internal/diagnostics"
	"github.com/floegence/redevplugin/pkg/mutation"
	"github.com/floegence/redevplugin/pkg/observability"
)

const (
	pluginAuditAction = "plugin_platform_event"
	pluginDiagScope   = "plugin-platform"
	pluginDiagKind    = "redevplugin"
)

// observabilityAdapter keeps ReDevPlugin's durable store authoritative while
// projecting a deliberately small, stable event into Redeven-wide sinks.
// Adapter/runtime error text and arbitrary details never cross this boundary.
type observabilityAdapter struct {
	primary     *observability.SQLiteStore
	audit       *auditlog.Store
	diagnostics *diagnostics.Store
}

func newObservabilityAdapter(primary *observability.SQLiteStore, audit *auditlog.Store, diagnostic *diagnostics.Store) *observabilityAdapter {
	return &observabilityAdapter{primary: primary, audit: audit, diagnostics: diagnostic}
}

func (o *observabilityAdapter) AppendPluginAudit(ctx context.Context, event observability.AuditEvent) error {
	if o == nil || o.primary == nil {
		return errors.New("plugin observability store is not configured")
	}
	err := o.primary.AppendPluginAudit(ctx, event)
	if err != nil {
		return err
	}
	if o.audit != nil {
		o.audit.Append(auditlog.Entry{
			Action: pluginAuditAction,
			Status: auditStatus(event.Details),
			Detail: projectedAuditDetail(event),
		})
	}
	return err
}

func (o *observabilityAdapter) AppendPluginDiagnostic(ctx context.Context, event observability.DiagnosticEvent) error {
	if o == nil || o.primary == nil {
		return errors.New("plugin observability store is not configured")
	}
	err := o.primary.AppendPluginDiagnostic(ctx, event)
	if err != nil {
		return err
	}
	if o.diagnostics != nil {
		o.diagnostics.Append(diagnostics.Event{
			Scope:   pluginDiagScope,
			Kind:    pluginDiagKind,
			TraceID: event.RequestID,
			Message: "plugin platform diagnostic",
			Detail:  projectedDiagnosticDetail(event),
		})
	}
	return err
}

func (o *observabilityAdapter) ListPluginDiagnostics(ctx context.Context, req observability.ListDiagnosticRequest) ([]observability.DiagnosticEvent, error) {
	if o == nil || o.primary == nil {
		return nil, errors.New("plugin observability store is not configured")
	}
	return o.primary.ListPluginDiagnostics(ctx, req)
}

func projectedAuditDetail(event observability.AuditEvent) map[string]any {
	detail := map[string]any{
		"event_type":          event.Type,
		"plugin_id":           event.PluginID,
		"plugin_instance_id":  event.PluginInstanceID,
		"surface_id":          event.SurfaceID,
		"surface_instance_id": event.SurfaceInstanceID,
		"request_id":          event.RequestID,
	}
	if outcome, ok := event.Details["mutation_outcome"].(string); ok {
		detail["mutation_outcome"] = outcome
	}
	if failure := projectedFailure(event.Details["failure"]); failure != nil {
		detail["failure"] = failure
	}
	return compactProjection(detail)
}

func projectedDiagnosticDetail(event observability.DiagnosticEvent) map[string]any {
	detail := map[string]any{
		"event_type":          event.Type,
		"severity":            event.Severity,
		"plugin_id":           event.PluginID,
		"plugin_instance_id":  event.PluginInstanceID,
		"surface_id":          event.SurfaceID,
		"surface_instance_id": event.SurfaceInstanceID,
		"request_id":          event.RequestID,
		"correlation_id":      event.CorrelationID,
		"mutation_outcome":    event.MutationOutcome,
	}
	if event.Failure.Valid() {
		detail["failure"] = map[string]any{
			"code":      event.Failure.Code,
			"component": event.Failure.Component,
			"operation": event.Failure.Operation,
		}
	}
	return compactProjection(detail)
}

func projectedFailure(value any) map[string]any {
	source := map[string]any{}
	switch typed := value.(type) {
	case observability.Failure:
		if !typed.Valid() {
			return nil
		}
		source["code"] = string(typed.Code)
		source["component"] = string(typed.Component)
		source["operation"] = string(typed.Operation)
	case map[string]any:
		source = typed
	default:
		return nil
	}
	out := map[string]any{}
	for _, key := range []string{"code", "component", "operation"} {
		if text, ok := source[key].(string); ok && text != "" {
			out[key] = text
		}
	}
	if len(out) != 3 {
		return nil
	}
	return out
}

func auditStatus(details map[string]any) string {
	outcome, _ := details["mutation_outcome"].(string)
	if outcome == string(mutation.OutcomeNotCommitted) || outcome == string(mutation.OutcomeUnknown) {
		return "failure"
	}
	return "success"
}

func compactProjection(detail map[string]any) map[string]any {
	for key, value := range detail {
		switch typed := value.(type) {
		case string:
			if typed == "" {
				delete(detail, key)
			}
		case mutation.Outcome:
			if typed == "" {
				delete(detail, key)
			}
		case observability.DiagnosticSeverity:
			if typed == "" {
				delete(detail, key)
			}
		}
	}
	return detail
}
