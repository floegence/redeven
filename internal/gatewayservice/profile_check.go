package gatewayservice

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/runtimeidentity"
)

// A draft check reads only public Runtime health over the same target policy as
// access sessions. It never publishes a profile, carries credentials or follows redirects.
func (s *Server) handleEnvProfileCheck(w http.ResponseWriter, r *http.Request) {
	body, verified, ok := s.readAuthenticatedBody(w, r)
	if !ok {
		return
	}
	if !s.profileWriteEnabled || !verified.ProfileWrite {
		writeGatewayError(w, http.StatusForbidden, protocol.GatewayErrorCodeUnauthorized, "Environment profile write permission is required.", false)
		return
	}
	var req protocol.EnvProfileCheckRequest
	if !decodeJSONBytes(w, body, &req) {
		return
	}
	nonce, err := base64.RawURLEncoding.DecodeString(req.ClientNonce)
	if req.ProtocolVersion != protocol.Version || err != nil || len(nonce) != 32 || base64.RawURLEncoding.EncodeToString(nonce) != req.ClientNonce {
		writeGatewayError(w, http.StatusBadRequest, protocol.GatewayErrorCodeInvalidRequest, "Invalid profile check request.", false)
		return
	}
	target, err := s.profileStore().ValidateURLTarget(req.TargetURL)
	if err != nil {
		writeProfileError(w, err)
		return
	}
	address, _ := url.Parse(target)
	address.Path = strings.TrimRight(address.Path, "/") + "/api/local/runtime/health"
	address.RawPath, address.RawQuery, address.Fragment = "", "", ""
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	upstream, _ := http.NewRequestWithContext(ctx, http.MethodGet, address.String(), nil)
	upstream.Header.Set("Accept", "application/json")
	upstream.Header.Set("X-Redeven-Runtime-Identity-Challenge", req.ClientNonce)
	response, err := s.proxyTransport.RoundTrip(upstream)
	unavailable := func() {
		writeGatewayError(w, http.StatusBadGateway, protocol.GatewayErrorCodeTargetUnavailable, "Gateway target unavailable.", true)
	}
	if err != nil {
		unavailable()
		return
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		unavailable()
		return
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, 65537))
	if err != nil || len(raw) > 65536 {
		unavailable()
		return
	}
	var health struct {
		OK   bool `json:"ok"`
		Data struct {
			Status           string                               `json:"status"`
			PasswordRequired *bool                                `json:"password_required"`
			Identity         *runtimeidentity.AccessIdentityProof `json:"access_identity"`
		} `json:"data"`
	}
	if json.Unmarshal(raw, &health) != nil || !health.OK || health.Data.Status != "online" || health.Data.PasswordRequired == nil {
		unavailable()
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeGatewayData(w, http.StatusOK, protocol.EnvProfileCheckResponse{
		ProtocolVersion: protocol.Version, AccessIdentity: health.Data.Identity,
	})
}
