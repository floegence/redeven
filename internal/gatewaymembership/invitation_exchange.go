package gatewaymembership

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

const InvitationExchangePath = "/v5/member/invitation-exchange"
const invitationExchangePurpose = "redeven.gateway.enrollment.v1"

var (
	ErrInvitationExpired = flowersec.RejectInvitationExchange("GATEWAY_INVITATION_EXPIRED")
	ErrInvitationUsed    = flowersec.RejectInvitationExchange("GATEWAY_INVITATION_USED")
	ErrInvitationInvalid = flowersec.RejectInvitationExchange("GATEWAY_INVITATION_INVALID")
)

func (s *Store) IssueInvitationCode(createdBy string) (gc.InvitationCodeDelivery, error) {
	descriptor, err := s.Invite(createdBy)
	if err != nil {
		return gc.InvitationCodeDelivery{}, err
	}
	return s.codeDelivery(descriptor)
}

func (s *Store) IssueInvitationCodeForCommand(createdBy, commandID string, expires time.Time) (gc.InvitationCodeDelivery, error) {
	descriptor, err := s.InviteForCommand(createdBy, commandID, expires)
	if err != nil {
		return gc.InvitationCodeDelivery{}, err
	}
	return s.codeDelivery(descriptor)
}

func (s *Store) codeDelivery(descriptor gp.EnrollmentDescriptor) (gc.InvitationCodeDelivery, error) {
	code, err := flowersec.DeriveInvitationCode(s.identity.PrivateKey.Seed(), descriptor.InvitationID)
	if err != nil {
		return gc.InvitationCodeDelivery{}, err
	}
	addresses := make([]string, 0, len(descriptor.Endpoints))
	for _, endpoint := range descriptor.Endpoints {
		addresses = append(addresses, endpoint.Address)
	}
	delivery := gc.InvitationCodeDelivery{ProtocolVersion: gp.Version, InvitationID: descriptor.InvitationID, GatewayID: descriptor.GatewayID, GatewayName: descriptor.GatewayName, GatewayPublicKey: descriptor.GatewayPublicKey, ShareAddress: addresses[0], ShareAddresses: addresses, Code: code.Text(), IssuedAtUnixMS: descriptor.IssuedAtUnixMS, ExpiresAtUnixMS: descriptor.ExpiresAtUnixMS}
	err = gc.SignInvitationCodeDelivery(&delivery, s.identity.PrivateKey)
	return delivery, err
}

func (s *Store) lookupInvitation(_ context.Context, lookup string) (flowersec.InvitationCode, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, record := range s.state.Invitations {
		if record.CodeLookupID == lookup && !record.Canceled {
			return flowersec.DeriveInvitationCode(s.identity.PrivateKey.Seed(), id)
		}
	}
	return flowersec.InvitationCode{}, ErrInvitationInvalid
}

func (s *Store) enrollmentDescriptor(lookup string) (gp.EnrollmentDescriptor, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, record := range s.state.Invitations {
		if record.CodeLookupID != lookup || record.Canceled {
			continue
		}
		if record.Response != nil || record.EndpointReceipt != nil {
			return gp.EnrollmentDescriptor{}, ErrInvitationUsed
		}
		if record.ExpiresAtUnixMS <= time.Now().UnixMilli() {
			return gp.EnrollmentDescriptor{}, ErrInvitationExpired
		}
		if record.Issued == nil {
			return gp.EnrollmentDescriptor{}, ErrState
		}
		descriptor := *record.Issued
		descriptor.Token = s.invitationToken(id)
		return descriptor, nil
	}
	return gp.EnrollmentDescriptor{}, ErrInvitationInvalid
}

func (s *Store) describeInvitation(_ context.Context, lookup string) ([]byte, error) {
	descriptor, err := s.enrollmentDescriptor(lookup)
	if err != nil {
		return nil, err
	}
	return json.Marshal(descriptor)
}

func (s *Store) InvitationExchangeHandler() (http.Handler, error) {
	return flowersec.NewInvitationExchangeHandler(flowersec.InvitationExchangeHandlerOptions{Purpose: invitationExchangePurpose, Lookup: s.lookupInvitation, Describe: s.describeInvitation})
}

// PreviewInvitation performs only the released SDK's authenticated exchange.
// Runtime consent and all durable state changes occur after explicit confirmation.
func PreviewInvitation(ctx context.Context, address, input string) (gp.EnrollmentDescriptor, error) {
	origin, err := canonicalOrigin(strings.TrimSpace(address))
	if err != nil {
		return gp.EnrollmentDescriptor{}, flowersec.RejectInvitationExchange("GATEWAY_ADDRESS_INVALID")
	}
	code, err := flowersec.ParseInvitationCode(input)
	if err != nil {
		return gp.EnrollmentDescriptor{}, ErrInvitationInvalid
	}
	raw, err := flowersec.ExchangeInvitation(ctx, flowersec.InvitationExchangeOptions{URL: "wss" + strings.TrimPrefix(origin, "https") + InvitationExchangePath, Purpose: invitationExchangePurpose, Code: code})
	if err != nil {
		return gp.EnrollmentDescriptor{}, err
	}
	var descriptor gp.EnrollmentDescriptor
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&descriptor) != nil || decoder.Decode(new(any)) != io.EOF || VerifyEnrollmentDescriptor(descriptor, time.Now()) != nil {
		return gp.EnrollmentDescriptor{}, ErrInvalidProof
	}
	confirmed := false
	for _, endpoint := range descriptor.Endpoints {
		confirmed = confirmed || endpoint.Address == origin
	}
	if !confirmed {
		return gp.EnrollmentDescriptor{}, ErrInvalidProof
	}
	return descriptor, nil
}
