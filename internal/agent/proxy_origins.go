package agent

import "strings"

// sessionProxyAllowedOrigins returns the browser-visible origins that may front
// this session's proxy upstream.
//
// The external origin is the agent's own configured launcher origin. In
// isolated runtimes the app window is additionally served from a control-plane
// minted host, reported through session_meta, and the data plane carries that
// host as the proxy frame's external origin. Flowersec admits exactly one origin
// by default, so both must be declared whenever they differ.
//
// The control plane is authoritative for AppOrigin, but a malformed or empty
// value must never widen the allowlist: it is ignored instead, keeping the
// agent's own origin as the only admitted one.
func sessionProxyAllowedOrigins(externalOrigin string, appOrigin string) []string {
	origin := strings.TrimSpace(externalOrigin)
	if origin == "" {
		return nil
	}
	allowed := []string{origin}
	candidate := strings.TrimSpace(appOrigin)
	if candidate == "" || candidate == origin {
		return allowed
	}
	return append(allowed, candidate)
}
