package tessiven

import (
	"context"
	"errors"
	"testing"

	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/session"
)

func TestRuntimeDirectoryReportsUnavailableSources(t *testing.T) {
	backend := &ResourceBackend{Broker: &Broker{}}
	directory, err := backend.Runtimes(t.Context(), &session.Meta{CanRead: true})
	if err != nil || len(directory.Sources) == 0 || directory.Sources[0].State != "unavailable" {
		t.Fatalf("unavailable Desktop masqueraded as an empty directory: %+v %v", directory, err)
	}
}
func TestRuntimeActionRequiresExactPathAndAuthority(t *testing.T) {
	backend := &ResourceBackend{Broker: &Broker{}}
	_, err := backend.Runtime(t.Context(), &session.Meta{CanRead: true}, RuntimeRequest{RuntimeRef: "ssh:guess", Action: "stop", Generation: "observed"})
	if !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("read-only lifecycle admitted: %v", err)
	}
	_, err = backend.Runtime(t.Context(), &session.Meta{CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true}, RuntimeRequest{RuntimeRef: "ssh:guess", Action: "connect"})
	if !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("unobserved path admitted: %v", err)
	}
}

func TestGatewayBusinessCannotForwardOrClaimPermission(t *testing.T) {
	backend := &ResourceBackend{RuntimeIdentity: func() string { return "actual-runtime" }}
	read := &session.Meta{CanRead: true}
	if _, err := backend.ExecuteBusiness(t.Context(), read, "actual-runtime", ResourceRequest{RuntimeRef: "local:local", Action: "list"}); err != nil {
		t.Fatal(err)
	}
	if _, err := backend.ExecuteBusiness(t.Context(), read, "replacement", ResourceRequest{RuntimeRef: "local:local", Action: "list"}); !errors.Is(err, ErrResourceChanged) {
		t.Fatal("unverified Runtime accepted", err)
	}
	if _, err := backend.ExecuteBusiness(t.Context(), read, "actual-runtime", ResourceRequest{RuntimeRef: "ssh:forward", Action: "list"}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatal("business forwarding accepted", err)
	}
	if _, err := backend.ExecuteBusiness(t.Context(), read, "actual-runtime", ResourceRequest{RuntimeRef: "local:local", Action: "stop", Binding: &Binding{Owner: "container", ResourceID: "fixture"}}); !errors.Is(err, ErrPermissionDenied) {
		t.Fatal("read-only target session mutated", err)
	}
	if _, err := backend.ExecuteBusiness(t.Context(), &session.Meta{CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true}, "actual-runtime", ResourceRequest{RuntimeRef: "local:local", Action: "update"}); !errors.Is(err, ErrInvalidRequest) {
		t.Fatal("Gateway process lifecycle accepted", err)
	}
}

func TestRuntimeGatewayCatalogRemainsInspectableWithoutDesktop(t *testing.T) {
	backend := &ResourceBackend{GatewayCatalog: func(context.Context) (gp.CatalogResponse, error) {
		return gp.CatalogResponse{Gateway: gp.GatewayMetadata{GatewayID: "gateway"}, Members: []gp.Member{{MemberID: "member", RuntimePublicID: "runtime", MemberVersion: 2, State: "active", Connected: false, DisplayName: "Saved"}}}, nil
	}}
	meta := &session.Meta{UserPublicID: "user_local", CanRead: true, CanAdmin: true}
	directory, err := backend.Runtimes(t.Context(), meta)
	if err != nil || len(directory.Targets) != 1 || directory.Sources[0].State != "unavailable" || directory.Sources[1].State != "available" {
		t.Fatalf("independent source lost: %+v %v", directory, err)
	}
	target := directory.Targets[0]
	if target.Connected || target.Authenticated != nil && *target.Authenticated || target.Online == nil || *target.Online || len(target.Actions) != 1 || target.Actions[0] != "status" {
		t.Fatalf("catalog invented a business session: %+v", target)
	}
	request := RuntimeRequest{RuntimeRef: target.RuntimeRef, Generation: target.Generation, Identity: target.Identity, Action: "status"}
	result, err := backend.Runtime(t.Context(), meta, request)
	if err != nil || result.Target == nil || result.Target.Identity != "runtime" {
		t.Fatal(result, err)
	}
	request.Generation = "1"
	if _, err = backend.Runtime(t.Context(), meta, request); !errors.Is(err, ErrResourceChanged) {
		t.Fatal("retired member admitted", err)
	}
}
func TestRuntimeCatalogDoesNotExposeHostMembersToCloudRights(t *testing.T) {
	called := false
	backend := &ResourceBackend{GatewayCatalog: func(context.Context) (gp.CatalogResponse, error) { called = true; return gp.CatalogResponse{}, nil }}
	_, err := backend.Runtimes(t.Context(), &session.Meta{UserPublicID: "cloud-user", CanRead: true, CanWrite: true, CanExecute: true, CanAdmin: true})
	if err != nil || called {
		t.Fatalf("Cloud rights borrowed host membership: %v %v", called, err)
	}
}
func TestRuntimeBusinessRechecksLiveTargetPolicy(t *testing.T) {
	backend := &ResourceBackend{RuntimeIdentity: func() string { return "runtime" }, Authorize: func(meta *session.Meta) *session.Meta { copy := *meta; copy.CanRead = false; return &copy }}
	_, err := backend.ExecuteBusiness(t.Context(), &session.Meta{CanRead: true}, "runtime", ResourceRequest{RuntimeRef: "local:local", Action: "list"})
	if !errors.Is(err, ErrPermissionDenied) {
		t.Fatal("revoked target read admitted", err)
	}
}
