package gatewaymembership

import (
	"crypto/ed25519"
	"crypto/x509"
	"encoding/json"
	"time"

	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

// Authenticate requires a verified client chain at the HTTP boundary as well
// as this current-certificate check. A CA signature alone never grants membership.
func (s *Store) Authenticate(leaf *x509.Certificate) (MemberRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.authenticateLocked(leaf)
}

func (s *Store) authenticateLocked(leaf *x509.Certificate) (MemberRecord, error) {
	if leaf == nil || time.Now().Before(leaf.NotBefore) || !time.Now().Before(leaf.NotAfter) {
		return MemberRecord{}, ErrDenied
	}
	member, ok := s.state.Members[leaf.Subject.CommonName]
	if !ok || member.Member.State != "active" || member.ClientCertificateSHA256 != digest(leaf.Raw) {
		return MemberRecord{}, ErrDenied
	}
	return cloneMember(member), nil
}

// Leave permits only the current identity or the exact removed identity's
// idempotent acknowledgement. It never reactivates the member.
func (s *Store) Leave(leaf *x509.Certificate, request gp.RemoveMemberRequest) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	member, ok := s.state.Members[request.MemberID]
	if leaf == nil || request.ExpectedMemberVersion < 1 || request.ProtocolVersion != gp.Version || leaf.Subject.CommonName != request.MemberID || !time.Now().Before(leaf.NotAfter) || time.Now().Before(leaf.NotBefore) {
		return ErrDenied
	}
	// A removed, acknowledged record may be compacted. The verified member CA
	// and exact certificate subject permit only an already-absent receipt.
	if !ok {
		return nil
	}
	fingerprint := digest(leaf.Raw)
	if member.ClientCertificateSHA256 != fingerprint && (member.Rotation == nil || member.Rotation.PreviousSHA256 != fingerprint || time.Now().UnixMilli() >= member.Rotation.PreviousExpiresAtUnixMS) {
		return ErrDenied
	}
	return s.removeLocked(request.MemberID, request.ExpectedMemberVersion)
}

// CancelJoin handles a lost enrollment response without issuing credentials or
// accepting a new member. The original signed request proves local ownership.
func (s *Store) CancelJoin(request gp.MemberJoinRequest) error {
	if request.ProtocolVersion != gp.Version || request.Delegation.GatewayID != s.identity.ID || request.InvitationID != request.Delegation.InvitationID || VerifyDelegation(request.Delegation) != nil {
		return ErrDenied
	}
	signature := request.Signature
	request.Signature = ""
	if err := verifyValue("redeven.gateway.member-join.v4", request, request.Delegation.PublicKeyB64u, signature); err != nil {
		return err
	}
	request.Signature = signature
	s.mu.Lock()
	defer s.mu.Unlock()
	record, exists := s.state.Invitations[request.InvitationID]
	if !exists {
		if member, ok := s.state.Members[request.Delegation.MemberID]; ok && member.Delegation == request.Delegation {
			if member.Member.State == "removed" {
				return nil
			}
			return s.removeLocked(member.Member.MemberID, member.Member.MemberVersion)
		}
		return nil
	}
	raw, _ := json.Marshal(request)
	if record.TokenSHA256 != digest([]byte(request.Token)) || (record.Response != nil && record.RequestSHA256 != digest(raw)) {
		return ErrDenied
	}
	if record.Canceled {
		return nil
	}
	if member, ok := s.state.Members[request.Delegation.MemberID]; ok && member.Member.State == "active" {
		if err := s.removeLocked(member.Member.MemberID, member.Member.MemberVersion); err != nil {
			return err
		}
	}
	next := s.clone()
	record.Canceled = true
	next.Invitations[request.InvitationID] = record
	return s.commit(next)
}

func SignRotation(request *gp.MemberRotateRequest, key ed25519.PrivateKey) error {
	request.Signature = ""
	signature, err := signValue("redeven.gateway.member-rotate.v4", *request, key)
	if err == nil {
		request.Signature = signature
	}
	return err
}

// Rotate consumes a currently valid member credential. Only an exact committed
// delivery may be recovered with the previous, still-unexpired certificate.
func (s *Store) Rotate(leaf *x509.Certificate, request gp.MemberRotateRequest) (gp.MemberRotateResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	member, ok := s.state.Members[request.MemberID]
	if leaf == nil || !ok || member.Member.State != "active" || leaf.Subject.CommonName != request.MemberID || now.Before(leaf.NotBefore) || !now.Before(leaf.NotAfter) || request.ProtocolVersion != gp.Version || request.GatewayID != s.identity.ID || request.MemberVersion != member.Member.MemberVersion || !validID(request.DeliveryID) {
		return gp.MemberRotateResponse{}, ErrDenied
	}
	signature := request.Signature
	request.Signature = ""
	if err := verifyValue("redeven.gateway.member-rotate.v4", request, member.Delegation.PublicKeyB64u, signature); err != nil {
		return gp.MemberRotateResponse{}, err
	}
	if err := VerifyMemberService(request.Service, member.Delegation, now); err != nil {
		return gp.MemberRotateResponse{}, err
	}
	raw, _ := json.Marshal(request)
	hash, fingerprint := digest(raw), digest(leaf.Raw)
	if previous := member.Rotation; previous != nil && previous.Response.DeliveryID == request.DeliveryID {
		if previous.RequestSHA256 != hash || (fingerprint != member.ClientCertificateSHA256 && (fingerprint != previous.PreviousSHA256 || now.UnixMilli() >= previous.PreviousExpiresAtUnixMS)) {
			return gp.MemberRotateResponse{}, ErrDenied
		}
		return previous.Response, nil
	}
	if request.Service.Revision != member.Service.Revision+1 {
		return gp.MemberRotateResponse{}, ErrConflict
	}
	if _, err := s.authenticateLocked(leaf); err != nil {
		return gp.MemberRotateResponse{}, err
	}
	certificate, nextFingerprint, expires, err := issueClientCertificate(s.state.Endpoint, request.ClientCSRPEM, request.MemberID)
	if err != nil {
		return gp.MemberRotateResponse{}, err
	}
	response := gp.MemberRotateResponse{ProtocolVersion: gp.Version, MemberID: request.MemberID, MemberVersion: request.MemberVersion, DeliveryID: request.DeliveryID, ClientCertificatePEM: certificate, ClientExpiresAtUnixMS: expires}
	member.Rotation = &rotationDelivery{PreviousSHA256: fingerprint, PreviousExpiresAtUnixMS: member.ClientExpiresAtUnixMS, RequestSHA256: hash, Response: response}
	member.ClientCertificatePEM, member.ClientCertificateSHA256, member.ClientExpiresAtUnixMS = certificate, nextFingerprint, expires
	member.Service = request.Service
	next := s.clone()
	next.Members[request.MemberID] = member
	if err := s.commit(next); err != nil {
		return gp.MemberRotateResponse{}, err
	}
	return response, nil
}

// RefreshHooks is local-host-only. It first fences all previous Cloud hook
// grants, including when configuration validation fails. Re-evaluation is explicit.
func (s *Store) RefreshHooks(config HookConfig) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	// Invalidate first, so a persistence failure cannot preserve stale grants.
	s.hooks.Invalidate()
	if err := s.fenceHookGrantsLocked(); err != nil {
		return err
	}
	return s.hooks.Replace(config)
}

// InvalidateHooks also fences Cloud grants when the local file cannot be read.
func (s *Store) InvalidateHooks() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.hooks.Invalidate()
	return s.fenceHookGrantsLocked()
}

func (s *Store) fenceHookGrantsLocked() error {
	next := s.clone()
	next.Policy.Revision++
	for id, member := range next.Members {
		member.HookCloudAllowed = false
		next.Members[id] = member
	}
	return s.commit(next)
}

// ServiceIdentity returns only the current member's signed public application
// identity. The caller must authenticate Desktop access before requesting it.
func (s *Store) ServiceIdentity(memberID string, version int64) (gp.MemberServiceResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	member, ok := s.state.Members[memberID]
	if !ok || member.Member.State != "active" || member.Member.MemberVersion != version {
		return gp.MemberServiceResponse{}, ErrDenied
	}
	if err := VerifyMemberService(member.Service, member.Delegation, time.Now()); err != nil {
		return gp.MemberServiceResponse{}, err
	}
	return gp.MemberServiceResponse{ProtocolVersion: gp.Version, MemberID: memberID, MemberVersion: version, Service: member.Service, Delegation: member.Delegation}, nil
}
