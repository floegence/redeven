package agent

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/floegence/flowersec/flowersec-go/endpoint"
	"github.com/floegence/redeven-agent/internal/accessgate"
	"github.com/floegence/redeven-agent/internal/auditlog"
	"github.com/floegence/redeven-agent/internal/diagnostics"
	"github.com/floegence/redeven-agent/internal/session"
)

func sanitizeAuditError(err error) string {
	if err == nil {
		return ""
	}
	s := strings.TrimSpace(err.Error())
	s = strings.ReplaceAll(s, "\r", " ")
	s = strings.ReplaceAll(s, "\n", " ")
	if len(s) > 240 {
		s = s[:240] + "..."
	}
	return s
}

// ServeLocalDirectSession serves an already-established direct (no tunnel) endpoint session.
//
// The session metadata MUST be treated as authoritative and is used to enforce permission caps.
type LocalDirectSessionOptions struct {
	AccessUnlocked        bool
	TraceID               string
	ConnectInfoIssuedAtMs int64
}

func (a *Agent) registerLocalDirectChannel(meta session.Meta, opts LocalDirectSessionOptions) func() {
	if a == nil || a.accessGate == nil || !a.accessGate.Enabled() {
		return func() {}
	}
	channelID := strings.TrimSpace(meta.ChannelID)
	if channelID == "" {
		return func() {}
	}

	a.accessGate.RegisterChannelWithOptions(meta, accessgate.RegisterChannelOptions{
		Unlocked: opts.AccessUnlocked,
	})
	return func() {
		a.accessGate.UnregisterChannel(channelID)
	}
}

func (a *Agent) ServeLocalDirectSession(ctx context.Context, sess endpoint.Session, meta *session.Meta, opts LocalDirectSessionOptions) (err error) {
	if a == nil {
		return errors.New("nil agent")
	}
	if ctx == nil {
		return errors.New("nil ctx")
	}
	if sess == nil {
		return errors.New("missing session")
	}
	if meta == nil {
		return errors.New("missing meta")
	}

	startedAt := time.Now()
	channelID := strings.TrimSpace(meta.ChannelID)
	if channelID == "" {
		return errors.New("missing channel_id")
	}

	connectedAtUnixMs := time.Now().UnixMilli()

	// Register in the in-memory session list so the Env App can show it under Monitoring.
	//
	// Note: Unlike control-plane notified sessions, local direct sessions are initiated by the local UI.
	// They are still tracked for UX/auditing parity with Standard Mode.
	sessCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	a.mu.Lock()
	if _, ok := a.sessions[channelID]; ok {
		a.mu.Unlock()
		return errors.New("session already active")
	}
	metaCopy := *meta
	a.sessions[channelID] = &activeSession{
		cancel:            cancel,
		meta:              metaCopy,
		tunnelURL:         "", // no tunnel in direct mode
		connectedAtUnixMs: connectedAtUnixMs,
	}
	a.mu.Unlock()

	cleanupAccessGate := a.registerLocalDirectChannel(metaCopy, opts)

	defer func() {
		cleanupAccessGate()
		a.mu.Lock()
		delete(a.sessions, channelID)
		a.mu.Unlock()

		reason := "eof"
		if errors.Is(err, context.Canceled) {
			reason = "canceled"
		} else if err != nil {
			reason = "error"
		}
		a.log.Info("local direct session closed",
			"channel_id", channelID,
			"env_public_id", strings.TrimSpace(meta.EndpointID),
			"floe_app", strings.TrimSpace(meta.FloeApp),
			"code_space_id", strings.TrimSpace(meta.CodeSpaceID),
			"user_public_id", strings.TrimSpace(meta.UserPublicID),
			"user_email", strings.TrimSpace(meta.UserEmail),
			"reason", reason,
			"duration_ms", time.Since(startedAt).Milliseconds(),
		)

		if a.diag != nil {
			statusCode := 0
			if err != nil && !errors.Is(err, context.Canceled) {
				statusCode = 1
			}
			a.diag.Append(diagnostics.Event{
				Scope:      diagnostics.ScopeDirectSession,
				Kind:       "closed",
				TraceID:    strings.TrimSpace(opts.TraceID),
				DurationMs: time.Since(startedAt).Milliseconds(),
				StatusCode: statusCode,
				Message:    reason,
				Detail: map[string]any{
					"channel_id":          channelID,
					"floe_app":            strings.TrimSpace(meta.FloeApp),
					"code_space_id":       strings.TrimSpace(meta.CodeSpaceID),
					"reason":              reason,
					"session_duration_ms": time.Since(startedAt).Milliseconds(),
				},
			})
		}

		if a.audit != nil {
			status := "success"
			if err != nil && !errors.Is(err, context.Canceled) {
				status = "failure"
			}
			a.audit.Append(auditlog.Entry{
				Action:            "session_closed",
				Status:            status,
				Error:             sanitizeAuditError(err),
				ChannelID:         channelID,
				EnvPublicID:       strings.TrimSpace(meta.EndpointID),
				NamespacePublicID: strings.TrimSpace(meta.NamespacePublicID),
				UserPublicID:      strings.TrimSpace(meta.UserPublicID),
				UserEmail:         strings.TrimSpace(meta.UserEmail),
				FloeApp:           strings.TrimSpace(meta.FloeApp),
				SessionKind:       strings.TrimSpace(meta.SessionKind),
				CodeSpaceID:       strings.TrimSpace(meta.CodeSpaceID),
				TunnelURL:         "",
				CanRead:           meta.CanRead,
				CanWrite:          meta.CanWrite,
				CanExecute:        meta.CanExecute,
				CanAdmin:          meta.CanAdmin,
				Detail: map[string]any{
					"mode":        "direct",
					"duration_ms": time.Since(startedAt).Milliseconds(),
				},
			})
		}
	}()

	if a.diag != nil {
		detail := map[string]any{
			"channel_id":    channelID,
			"floe_app":      strings.TrimSpace(meta.FloeApp),
			"code_space_id": strings.TrimSpace(meta.CodeSpaceID),
		}
		if opts.ConnectInfoIssuedAtMs > 0 {
			detail["connect_info_age_ms"] = time.Now().UnixMilli() - opts.ConnectInfoIssuedAtMs
		}
		a.diag.Append(diagnostics.Event{
			Scope:      diagnostics.ScopeDirectSession,
			Kind:       "opened",
			TraceID:    strings.TrimSpace(opts.TraceID),
			DurationMs: time.Since(startedAt).Milliseconds(),
			Message:    "local direct session opened",
			Detail:     detail,
		})
	}

	a.log.Info("local direct session opened",
		"channel_id", channelID,
		"env_public_id", strings.TrimSpace(meta.EndpointID),
		"floe_app", strings.TrimSpace(meta.FloeApp),
		"code_space_id", strings.TrimSpace(meta.CodeSpaceID),
		"user_public_id", strings.TrimSpace(meta.UserPublicID),
		"user_email", strings.TrimSpace(meta.UserEmail),
		"connected_at_unix_ms", connectedAtUnixMs,
	)

	if a.audit != nil {
		a.audit.Append(auditlog.Entry{
			Action:            "session_opened",
			Status:            "success",
			ChannelID:         channelID,
			EnvPublicID:       strings.TrimSpace(meta.EndpointID),
			NamespacePublicID: strings.TrimSpace(meta.NamespacePublicID),
			UserPublicID:      strings.TrimSpace(meta.UserPublicID),
			UserEmail:         strings.TrimSpace(meta.UserEmail),
			FloeApp:           strings.TrimSpace(meta.FloeApp),
			SessionKind:       strings.TrimSpace(meta.SessionKind),
			CodeSpaceID:       strings.TrimSpace(meta.CodeSpaceID),
			TunnelURL:         "",
			CanRead:           meta.CanRead,
			CanWrite:          meta.CanWrite,
			CanExecute:        meta.CanExecute,
			CanAdmin:          meta.CanAdmin,
			Detail: map[string]any{
				"mode": "direct",
			},
		})
	}

	defer sess.Close()

	switch strings.TrimSpace(meta.FloeApp) {
	case FloeAppRedevenCode:
		return a.serveCodeAppSession(sessCtx, sess, meta)
	case FloeAppRedevenPortForward:
		return a.servePortForwardSession(sessCtx, sess, meta)
	default:
		return a.serveRedevenAgentSession(sessCtx, sess, meta)
	}
}
