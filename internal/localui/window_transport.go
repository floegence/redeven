package localui

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/floegence/redeven/internal/agent"
	"github.com/floegence/redeven/internal/codeapp/appserver"
	"github.com/floegence/redeven/internal/runtimeproxy"
	"github.com/floegence/redeven/internal/session"
)

func (s *Server) handleWindowTransport(w http.ResponseWriter, r *http.Request, id, base string) bool {
	path := strings.TrimPrefix(r.URL.Path, base)
	if !strings.HasPrefix(path, appserver.WindowTransportPath) {
		return false
	}
	if !s.requireLocalAccessAPI(w, r) {
		return true
	}
	if s.appServer == nil {
		http.NotFound(w, r)
		return true
	}
	meta, ok := s.appServer.LocalWindowSessionMeta(w, r, id)
	if !ok {
		return true
	}
	switch path {
	case appserver.WindowTransportPath + "connect":
		s.handleConnectArtifactWithMeta(w, r, meta)
	case appserver.WindowTransportPath + "spend":
		s.handleArtifactSpend(w, r)
	default:
		http.NotFound(w, r)
	}
	return true
}

func localSessionProxyScope(meta session.Meta, origin string) (payload, projection string, target []byte) {
	if meta.FloeApp != agent.FloeAppRedevenPortForward {
		return localProxyRuntimePayloadJSON(), localProjectionJSON(), localTargetBindingJSON()
	}
	encoded, _ := json.Marshal(map[string]any{
		"version": 2, "mode": "controller_bridge", "appBasePath": "/",
		"controllerBridge": map[string]any{"allowedOrigins": []string{origin}},
		"limits":           map[string]any{"maxWsFrameBytes": runtimeproxy.MaxWSFrameBytes},
	})
	target, _ = json.Marshal(map[string]any{"v": 1, "kind": "window", "env_public_id": "env_local", "floe_app": agent.FloeAppRedevenPortForward, "forward_id": meta.CodeSpaceID})
	payload = string(encoded)
	projection = `{"scope":"proxy.runtime","scope_version":2,"critical":true,"payload":` + payload + `}`
	return
}
