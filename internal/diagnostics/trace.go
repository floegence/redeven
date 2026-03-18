package diagnostics

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"strings"
)

const (
	SourceAgent   = "agent"
	SourceDesktop = "desktop"

	TraceHeader = "X-Redeven-Debug-Trace-ID"

	ScopeDesktopHTTP      = "desktop_http"
	ScopeDesktopLifecycle = "desktop_lifecycle"
	ScopeLocalUIHTTP      = "localui_http"
	ScopeGatewayAPI       = "gateway_api"
	ScopeDirectSession    = "direct_session"
)

type traceContextKey struct{}

func EnabledForLogLevel(level string) bool {
	return strings.EqualFold(strings.TrimSpace(level), "debug")
}

func NewTraceID() string {
	var raw [12]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return ""
	}
	return hex.EncodeToString(raw[:])
}

func WithTraceID(ctx context.Context, traceID string) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	traceID = strings.TrimSpace(traceID)
	if traceID == "" {
		return ctx
	}
	return context.WithValue(ctx, traceContextKey{}, traceID)
}

func TraceIDFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	traceID, _ := ctx.Value(traceContextKey{}).(string)
	return strings.TrimSpace(traceID)
}

func ShouldMarkSlow(scope string, kind string, durationMs int64) bool {
	if durationMs < 1000 {
		return false
	}
	switch strings.TrimSpace(scope) {
	case ScopeDesktopHTTP, ScopeLocalUIHTTP, ScopeGatewayAPI:
		return true
	case ScopeDirectSession:
		switch strings.TrimSpace(kind) {
		case "opened", "handshake_failed":
			return true
		default:
			return false
		}
	default:
		return false
	}
}
