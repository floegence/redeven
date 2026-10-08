package gatewayservice

import (
	"github.com/floegence/redeven/internal/runtimeservice"
	"net/http"
	"time"

	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/runtimegateway/security"
)

// Address changes prove possession of the pinned machine key with fresh caller
// input. An address or a copied public fingerprint cannot replace this proof.
func (s *Server) handleIdentity(w http.ResponseWriter, r *http.Request) {
	var request gp.IdentityRequest
	client, ok := s.authenticated(w, r, &request)
	if !ok {
		return
	}
	if len(request.Nonce) < 24 || len(request.Nonce) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST")
		return
	}
	metadata, _, err := s.trust.GatewayMetadata(client.BindingAudience)
	if err != nil {
		writeResult(w, nil, err)
		return
	}
	response := gp.IdentityResponse{ProtocolVersion: gp.Version, GatewayID: metadata.GatewayID,
		CompatibilityEpoch: runtimeservice.CurrentCompatibilityContract().CompatibilityEpoch, BindingAudience: client.BindingAudience, Nonce: request.Nonce, ExpiresAtUnixMS: time.Now().Add(time.Minute).UnixMilli()}
	payload, err := security.CanonicalJSON(response)
	if err != nil {
		writeResult(w, nil, err)
		return
	}
	key, err := s.trust.GatewayPrivateKey()
	if err != nil {
		writeResult(w, nil, err)
		return
	}
	response.Signature, err = security.SignPayload(key, payload)
	writeResult(w, response, err)
}
