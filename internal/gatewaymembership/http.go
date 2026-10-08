package gatewaymembership

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

// RegisterMemberHandlers adds only Runtime-owned enrollment and rotation. Admin
// invitation and member policy operations belong to the paired Gateway API.
func (s *Store) RegisterMemberHandlers(mux *http.ServeMux) {
	mux.HandleFunc("POST /v5/member/cancel-join", func(w http.ResponseWriter, r *http.Request) {
		var request gp.MemberJoinRequest
		if !decodeMemberRequest(w, r, &request) {
			return
		}
		writeMemberResponse(w, gp.CatalogRequest{ProtocolVersion: gp.Version}, s.CancelJoin(request))
	})
	mux.HandleFunc("POST /v5/member/leave", func(w http.ResponseWriter, r *http.Request) {
		if r.TLS == nil || len(r.TLS.VerifiedChains) == 0 || len(r.TLS.PeerCertificates) == 0 {
			writeMemberResponse(w, nil, ErrDenied)
			return
		}
		var request gp.RemoveMemberRequest
		if !decodeMemberRequest(w, r, &request) {
			return
		}
		writeMemberResponse(w, gp.CatalogRequest{ProtocolVersion: gp.Version}, s.Leave(r.TLS.PeerCertificates[0], request))
	})
	mux.HandleFunc("POST /v5/member/join", func(w http.ResponseWriter, r *http.Request) {
		var request gp.MemberJoinRequest
		if !decodeMemberRequest(w, r, &request) {
			return
		}
		response, err := s.Join(r.Context(), request)
		writeMemberResponse(w, response, err)
	})
	mux.HandleFunc("POST /v5/member/rotate", func(w http.ResponseWriter, r *http.Request) {
		if r.TLS == nil || len(r.TLS.VerifiedChains) == 0 || len(r.TLS.PeerCertificates) == 0 {
			writeMemberResponse(w, nil, ErrDenied)
			return
		}
		var request gp.MemberRotateRequest
		if !decodeMemberRequest(w, r, &request) {
			return
		}
		response, err := s.Rotate(r.TLS.PeerCertificates[0], request)
		writeMemberResponse(w, response, err)
	})
	mux.HandleFunc("POST /v5/member/connect", func(w http.ResponseWriter, r *http.Request) {
		if r.TLS == nil || len(r.TLS.VerifiedChains) == 0 || len(r.TLS.PeerCertificates) == 0 {
			writeMemberResponse(w, nil, ErrDenied)
			return
		}
		var request gp.MemberConnectRequest
		if !decodeMemberRequest(w, r, &request) {
			return
		}
		if request.ProtocolVersion != gp.Version {
			writeMemberResponse(w, nil, ErrDenied)
			return
		}
		response, err := s.MemberOffer(r.TLS.PeerCertificates[0], request.Endpoint)
		writeMemberResponse(w, response, err)
	})

}

func decodeMemberRequest(w http.ResponseWriter, r *http.Request, out any) bool {
	w.Header().Set("Cache-Control", "no-store")
	if r.Header.Get("Origin") != "" || r.Header.Get("Content-Type") != "application/json" {
		http.Error(w, "MEMBER_REQUEST_INVALID", http.StatusBadRequest)
		return false
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
	decoder.DisallowUnknownFields()
	if decoder.Decode(out) != nil || decoder.Decode(new(any)) != io.EOF {
		http.Error(w, "MEMBER_REQUEST_INVALID", http.StatusBadRequest)
		return false
	}
	return true
}

func writeMemberResponse(w http.ResponseWriter, value any, err error) {
	w.Header().Set("Cache-Control", "no-store")
	if err != nil {
		status, code := http.StatusForbidden, "MEMBER_DENIED"
		if errors.Is(err, ErrConflict) {
			status, code = http.StatusConflict, "MEMBER_VERSION_CONFLICT"
		}
		if errors.Is(err, ErrCapacity) {
			status, code = http.StatusTooManyRequests, "MEMBER_CAPACITY"
		}
		if errors.Is(err, errGatewayUnavailable) {
			status, code = http.StatusServiceUnavailable, "GATEWAY_UNAVAILABLE"
		}
		http.Error(w, code, status)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(value)
}
