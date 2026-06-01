package session

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/floegence/redeven/internal/runtimegateway/protocol"
)

func TestOpenSessionValidatesRequest(t *testing.T) {
	_, err := NewService().OpenSession(context.Background(), protocol.OpenSessionRequest{})
	if !IsGatewayErrorCode(err, ErrorCodeInvalidRequest) {
		t.Fatalf("OpenSession() error = %v, want %s", err, ErrorCodeInvalidRequest)
	}
	if ErrorContainsCredentialWord(err) {
		t.Fatalf("OpenSession() error leaks credential-shaped wording: %v", err)
	}
}

func TestOpenSessionReturnsTypedNotImplementedWithoutCredentialLeak(t *testing.T) {
	_, err := NewService().OpenSession(context.Background(), protocol.OpenSessionRequest{
		EnvPublicID: " env_demo ",
	})
	if !IsGatewayErrorCode(err, ErrorCodeNotImplemented) {
		t.Fatalf("OpenSession() error = %v, want %s", err, ErrorCodeNotImplemented)
	}
	if ErrorContainsCredentialWord(err) {
		t.Fatalf("OpenSession() error leaks credential-shaped wording: %v", err)
	}
}

func ErrorContainsCredentialWord(err error) bool {
	msg := strings.ToLower(fmt.Sprint(err))
	return strings.Contains(msg, "bearer") || strings.Contains(msg, "token")
}
