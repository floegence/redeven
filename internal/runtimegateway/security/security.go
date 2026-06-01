package security

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"strings"
)

const SignatureAlgorithm = "ed25519"

type KeyPair struct {
	PublicKeyPEM  string
	PrivateKeyPEM string
}

func GenerateKeyPair() (KeyPair, error) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return KeyPair{}, err
	}
	publicDER, err := x509.MarshalPKIXPublicKey(publicKey)
	if err != nil {
		return KeyPair{}, err
	}
	privateDER, err := x509.MarshalPKCS8PrivateKey(privateKey)
	if err != nil {
		return KeyPair{}, err
	}
	return KeyPair{
		PublicKeyPEM: string(pem.EncodeToMemory(&pem.Block{
			Type:  "PUBLIC KEY",
			Bytes: publicDER,
		})),
		PrivateKeyPEM: string(pem.EncodeToMemory(&pem.Block{
			Type:  "PRIVATE KEY",
			Bytes: privateDER,
		})),
	}, nil
}

func PublicKeyFingerprint(publicKeyPEM string) (string, error) {
	clean := strings.TrimSpace(publicKeyPEM)
	if clean == "" {
		return "", errors.New("public key is required")
	}
	return "SHA256:" + SHA256Base64URL(clean), nil
}

func ClientKeyID(publicKeyPEM string) string {
	sum := SHA256Base64URL(publicKeyPEM)
	if len(sum) > 24 {
		sum = sum[:24]
	}
	return "gck_" + sum
}

func StableGatewayID(bindingAudience string) string {
	sum := SHA256Base64URL(strings.TrimSpace(bindingAudience))
	if len(sum) > 24 {
		sum = sum[:24]
	}
	return "gw_" + sum
}

func SHA256Base64URL(value string) string {
	sum := sha256.Sum256([]byte(value))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func CanonicalJSON(value any) (string, error) {
	if value == nil {
		return "", nil
	}
	data, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func CanonicalJSONDigestFromBytes(body []byte) (string, error) {
	if len(strings.TrimSpace(string(body))) == 0 {
		return SHA256Base64URL(""), nil
	}
	var value any
	if err := json.Unmarshal(body, &value); err != nil {
		return "", err
	}
	canonical, err := CanonicalJSON(value)
	if err != nil {
		return "", err
	}
	return SHA256Base64URL(canonical), nil
}

func SignPayload(privateKeyPEM string, payload string) (string, error) {
	privateKey, err := parsePrivateKey(privateKeyPEM)
	if err != nil {
		return "", err
	}
	sig := ed25519.Sign(privateKey, []byte(payload))
	return base64.RawURLEncoding.EncodeToString(sig), nil
}

func VerifySignature(publicKeyPEM string, payload string, signature string) bool {
	publicKey, err := parsePublicKey(publicKeyPEM)
	if err != nil {
		return false
	}
	sig, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(signature))
	if err != nil {
		return false
	}
	return ed25519.Verify(publicKey, []byte(payload), sig)
}

func parsePublicKey(publicKeyPEM string) (ed25519.PublicKey, error) {
	block, _ := pem.Decode([]byte(strings.TrimSpace(publicKeyPEM)))
	if block == nil {
		return nil, errors.New("public key PEM is invalid")
	}
	parsed, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	key, ok := parsed.(ed25519.PublicKey)
	if !ok {
		return nil, fmt.Errorf("public key is not %s", SignatureAlgorithm)
	}
	return key, nil
}

func parsePrivateKey(privateKeyPEM string) (ed25519.PrivateKey, error) {
	block, _ := pem.Decode([]byte(strings.TrimSpace(privateKeyPEM)))
	if block == nil {
		return nil, errors.New("private key PEM is invalid")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	key, ok := parsed.(ed25519.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("private key is not %s", SignatureAlgorithm)
	}
	return key, nil
}
