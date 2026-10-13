package protocol

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
)

func enrollmentMembershipBytes(proof Proof, request EnrollRequest) ([]byte, error) {
	proof.Signature, proof.BodySHA256 = "", ""
	request.Authorization.MemberAuthorization = ""
	raw, err := json.Marshal(struct {
		Proof   Proof         `json:"proof"`
		Request EnrollRequest `json:"request"`
	}{proof, request})
	return append([]byte("redeven.runtime.cloud.membership.rcpp-v5\x00"), raw...), err
}

func SignEnrollmentMembership(proof Proof, request *EnrollRequest, memberKey ed25519.PrivateKey) error {
	if request == nil || len(memberKey) != ed25519.PrivateKeySize {
		return errors.New("invalid enrollment member key")
	}
	raw, err := enrollmentMembershipBytes(proof, *request)
	if err != nil {
		return err
	}
	request.Authorization.MemberAuthorization = base64.RawURLEncoding.EncodeToString(ed25519.Sign(memberKey, raw))
	return nil
}

func VerifyEnrollmentMembership(proof Proof, request EnrollRequest, memberKeyB64u string) error {
	if !ValidPublicKey(memberKeyB64u) {
		return errors.New("invalid enrollment member identity")
	}
	key, _ := base64.RawURLEncoding.DecodeString(memberKeyB64u)
	signature, err := base64.RawURLEncoding.DecodeString(request.Authorization.MemberAuthorization)
	if err != nil || len(signature) != ed25519.SignatureSize || base64.RawURLEncoding.EncodeToString(signature) != request.Authorization.MemberAuthorization {
		return errors.New("invalid enrollment member authorization")
	}
	raw, err := enrollmentMembershipBytes(proof, request)
	if err != nil || !ed25519.Verify(key, raw, signature) {
		return errors.New("enrollment member authorization mismatch")
	}
	return nil
}
