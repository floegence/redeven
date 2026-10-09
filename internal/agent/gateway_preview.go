package agent

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"time"

	"github.com/floegence/redeven/internal/gatewaymembership"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

var ErrGatewayPreviewExpired = errors.New("GATEWAY_PREVIEW_EXPIRED")
var ErrGatewayPreviewChanged = errors.New("GATEWAY_PREVIEW_CHANGED")

type GatewayPreview struct {
	PreviewID             string `json:"preview_id"`
	Purpose               string `json:"purpose"`
	GatewayID             string `json:"gateway_id"`
	GatewayName           string `json:"gateway_name"`
	TargetRuntimeID       string `json:"target_runtime_id"`
	ExpiresAtUnixMS       int64  `json:"expires_at_unix_ms"`
	ExistingEnvironmentID string `json:"existing_environment_id,omitempty"`
}

type gatewayPreview struct {
	GatewayPreview
	descriptor gp.EnrollmentDescriptor
	memberID   string
	revision   uint64
}

// PreviewGateway leaves configuration, running transports and Cloud credentials
// untouched. The target Runtime, rather than Desktop, owns this network request.
func (a *Agent) PreviewGateway(ctx context.Context, address, code, purpose string) (GatewayPreview, error) {
	if purpose != "join" && purpose != "replace" && purpose != "update-endpoints" {
		return GatewayPreview{}, gatewaymembership.ErrState
	}
	a.mu.Lock()
	if a.cfg == nil {
		a.mu.Unlock()
		return GatewayPreview{}, gatewaymembership.ErrState
	}
	runtimeID, environmentID := a.cfg.LocalEnvironmentPublicID, a.cfg.EnvironmentID
	current := a.cfg.Gateway.Clone()
	a.mu.Unlock()
	if runtimeID == "" || purpose == "join" && current != nil || purpose != "join" && current == nil {
		return GatewayPreview{}, gatewaymembership.ErrConflict
	}
	descriptor, err := gatewaymembership.PreviewInvitation(ctx, address, code)
	if err != nil {
		return GatewayPreview{}, err
	}
	if purpose == "update-endpoints" && (descriptor.GatewayID != current.GatewayID || descriptor.GatewayPublicKey != current.GatewayPublicKey || descriptor.GatewayTLSRootPEM != current.GatewayTLSRootPEM) {
		return GatewayPreview{}, gatewaymembership.ErrInvalidProof
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return GatewayPreview{}, err
	}
	expires := min(descriptor.ExpiresAtUnixMS, time.Now().Add(5*time.Minute).UnixMilli())
	preview := gatewayPreview{GatewayPreview: GatewayPreview{PreviewID: base64.RawURLEncoding.EncodeToString(raw), Purpose: purpose, GatewayID: descriptor.GatewayID, GatewayName: descriptor.GatewayName, TargetRuntimeID: runtimeID, ExpiresAtUnixMS: expires, ExistingEnvironmentID: environmentID}, descriptor: descriptor}
	if current != nil {
		preview.memberID, preview.revision = current.MemberID, current.Revision
	}
	a.gatewayMember.mu.Lock()
	defer a.gatewayMember.mu.Unlock()
	if a.gatewayMember.previews == nil {
		a.gatewayMember.previews = map[string]gatewayPreview{}
	}
	for id, value := range a.gatewayMember.previews {
		if value.ExpiresAtUnixMS <= time.Now().UnixMilli() {
			delete(a.gatewayMember.previews, id)
		}
	}
	if len(a.gatewayMember.previews) >= 32 {
		return GatewayPreview{}, gatewaymembership.ErrCapacity
	}
	a.gatewayMember.previews[preview.PreviewID] = preview
	return preview.GatewayPreview, nil
}

func (a *Agent) ConfirmGatewayPreview(previewID, purpose, choice string) error {
	a.cloudLinkMu.Lock()
	defer a.cloudLinkMu.Unlock()
	a.gatewayMember.mu.Lock()
	defer a.gatewayMember.mu.Unlock()
	preview, ok := a.gatewayMember.previews[previewID]
	if !ok || preview.ExpiresAtUnixMS <= time.Now().UnixMilli() {
		return ErrGatewayPreviewExpired
	}
	if preview.Purpose != purpose {
		return ErrGatewayPreviewChanged
	}
	a.mu.Lock()
	if a.cfg == nil || a.cfg.LocalEnvironmentPublicID != preview.TargetRuntimeID {
		a.mu.Unlock()
		return ErrGatewayPreviewChanged
	}
	current := a.cfg.Gateway.Clone()
	sameEnvironment := a.cfg.EnvironmentID == preview.ExistingEnvironmentID
	choiceMatches := a.cfg.GatewayEnvironmentChoice == choice
	a.mu.Unlock()
	if purpose != "update-endpoints" && current != nil && current.Delegation.InvitationID == preview.descriptor.InvitationID && choiceMatches {
		return nil
	}
	if !sameEnvironment || current == nil && preview.memberID != "" || current != nil && (current.MemberID != preview.memberID || current.Revision != preview.revision) {
		return ErrGatewayPreviewChanged
	}
	switch purpose {
	case "join":
		return a.changeGateway(preview.descriptor, choice, false)
	case "replace":
		return a.changeGateway(preview.descriptor, choice, true)
	case "update-endpoints":
		if choice != "" {
			return gatewaymembership.ErrState
		}
		return a.updateGatewayEndpoints(preview.descriptor)
	default:
		return gatewaymembership.ErrState
	}
}
