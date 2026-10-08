package gatewaymembership

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"github.com/floegence/redeven/internal/gatewayflow"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"golang.org/x/net/dns/dnsmessage"
)

func forwardGatewayTCP(t *testing.T, target string) (string, func()) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	var workers sync.WaitGroup
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			incoming, err := listener.Accept()
			if err != nil {
				return
			}
			workers.Add(1)
			go func() {
				defer workers.Done()
				defer incoming.Close()
				stopIncoming := context.AfterFunc(ctx, func() { _ = incoming.Close() })
				defer stopIncoming()
				outgoing, err := (&net.Dialer{}).DialContext(ctx, "tcp", target)
				if err != nil {
					return
				}
				defer outgoing.Close()
				stopOutgoing := context.AfterFunc(ctx, func() { _ = outgoing.Close() })
				defer stopOutgoing()
				copied := make(chan struct{})
				go func() { defer close(copied); _, _ = io.Copy(outgoing, incoming); _ = outgoing.Close() }()
				_, _ = io.Copy(incoming, outgoing)
				_ = incoming.Close()
				<-copied
			}()
		}
	}()
	var once sync.Once
	closeForward := func() { once.Do(func() { cancel(); _ = listener.Close(); <-done; workers.Wait() }) }
	t.Cleanup(closeForward)
	_, port, _ := net.SplitHostPort(listener.Addr().String())
	return "https://localhost:" + port, closeForward
}

func waitGatewayCondition(t *testing.T, ctx context.Context, condition func() bool) {
	t.Helper()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for !condition() {
		select {
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-ticker.C:
		}
	}
}

func TestRuntimeNetworkEndpointAcceptance(t *testing.T) {
	store, identity := membershipStore(t)
	lan, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = lan.Close() })
	private, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = private.Close() })
	publicAddress, closePublic := forwardGatewayTCP(t, private.Addr().String())
	lanAddress, closeLAN := forwardGatewayTCP(t, lan.Addr().String())
	lanURL, _ := url.Parse(lanAddress)
	lanAddress = "https://" + net.JoinHostPort("127.0.0.1", lanURL.Port())
	store, err = NewStore(filepath.Join(t.TempDir(), "members.json"), identity, "https://"+lan.Addr().String(), lan.Addr().String(), store.hooks)
	if err != nil {
		t.Fatal(err)
	}
	lanEndpoint := gp.GatewayEndpoint{EndpointID: "lan", Address: lanAddress, Scope: gp.GatewayEndpointLAN, Priority: 0}
	publicEndpoint := gp.GatewayEndpoint{EndpointID: "public", Address: publicAddress, Scope: gp.GatewayEndpointPublic, Priority: 1}
	if err := store.UpdateEndpoints([]gp.GatewayEndpoint{publicEndpoint, lanEndpoint}); err != nil {
		t.Fatal(err)
	}
	connections := NewConnections(gatewayflow.New(0, 0))
	t.Cleanup(connections.Close)
	store.SetCommitHandler(connections.Apply)
	endpoint, err := NewListener(store, connections, func(string) bool { return true })
	if err != nil {
		t.Fatal(err)
	}
	trust, err := store.TLSConfig()
	if err != nil {
		t.Fatal(err)
	}
	lanServer, err := endpoint.Server(trust, nil)
	if err != nil {
		t.Fatal(err)
	}
	privateServer, err := endpoint.Server(trust, nil)
	if err != nil {
		t.Fatal(err)
	}
	lanDone, privateDone := make(chan struct{}), make(chan struct{})
	go func() { defer close(lanDone); _ = lanServer.Serve(lan) }()
	go func() { defer close(privateDone); _ = privateServer.Serve(private) }()
	t.Cleanup(func() { _ = lanServer.Close(); _ = privateServer.Close(); <-lanDone; <-privateDone })
	invitation, err := store.Invite("admin")
	if err != nil {
		t.Fatal(err)
	}
	state, err := PrepareRuntime(invitation, "runtime_network", gp.MemberMetadata{Hostname: "Network test"})
	if err != nil {
		t.Fatal(err)
	}
	var stateMu sync.Mutex
	current := func() *RuntimeConfig { stateMu.Lock(); defer stateMu.Unlock(); return state.Clone() }
	persist := func(next *RuntimeConfig) error {
		stateMu.Lock()
		defer stateMu.Unlock()
		state = next.Clone()
		return nil
	}
	runtime, err := NewRuntimeConnection(current, persist)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 25*time.Second)
	defer cancel()
	runtimeDone := make(chan error, 1)
	go func() {
		runErr := runtime.Run(ctx, func(string) RuntimeApplication {
			return RuntimeApplication{Handler: http.NotFoundHandler(), WebSocketHandler: http.NotFoundHandler()}
		})
		if runErr != nil && !errors.Is(runErr, context.Canceled) && !errors.Is(runErr, context.DeadlineExceeded) {
			t.Logf("Runtime connection ended: %v", runErr)
		}
		runtimeDone <- runErr
	}()
	defer func() { cancel(); <-runtimeDone }()
	defer func() {
		if t.Failed() {
			snapshot := runtime.Snapshot()
			t.Logf("connection state=%s endpoint=%s usage=%v", snapshot.State, current().LastEndpointID, store.EndpointUsage())
			if snapshot.Failure != nil {
				t.Logf("connection failure: %+v", snapshot.Failure.Error)
			}
		}
	}()
	waitGatewayCondition(t, ctx, func() bool {
		return runtime.Snapshot().State == flowersec.ConnectionConnected && current().LastEndpointID == "lan" && store.EndpointUsage()["lan"] > 0
	})
	original := current()
	closeLAN()
	waitGatewayCondition(t, ctx, func() bool {
		return runtime.Snapshot().State == flowersec.ConnectionConnected && current().LastEndpointID == "public" && store.EndpointUsage()["public"] > 0
	})
	if current().MemberID != original.MemberID || current().MemberVersion != original.MemberVersion || current().ClientCertificatePEM != original.ClientCertificatePEM {
		t.Fatal("failover changed membership identity or credentials")
	}
	if current().ConnectionEndpoints()[0] != publicEndpoint {
		t.Fatal("recently successful endpoint was not preferred")
	}
	if publicAddress == "https://"+private.Addr().String() {
		t.Fatal("forwarding fixture did not separate advertised and local addresses")
	}
	newAddress, closeNew := forwardGatewayTCP(t, private.Addr().String())
	defer closeNew()
	newEndpoint := gp.GatewayEndpoint{EndpointID: "public_new", Address: newAddress, Scope: gp.GatewayEndpointPublic, Priority: 0}
	if err := store.UpdateEndpoints([]gp.GatewayEndpoint{newEndpoint}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.MemberOffer(mustClientLeaf(t, current()), publicEndpoint); !errors.Is(err, errGatewayUnavailable) {
		t.Fatalf("deleted endpoint was accepted: %v", err)
	}
	closePublic()
	waitGatewayCondition(t, ctx, func() bool { return runtime.Snapshot().State != flowersec.ConnectionConnected })
	if err := current().Request(ctx, "/v5/member/connect", gp.MemberConnectRequest{ProtocolVersion: gp.Version}, &ConnectionOffer{}, true); !errors.Is(err, errGatewayUnavailable) {
		t.Fatalf("all unreachable routes must return Gateway unavailable: %v", err)
	}
	if store.EndpointUsage()["public_new"] != 0 {
		t.Fatal("an unapproved endpoint was used")
	}
	updatedInvitation, err := store.Invite("admin")
	if err != nil {
		t.Fatal(err)
	}
	updated, err := current().PrepareConnectionEndpoints(updatedInvitation)
	if err != nil {
		t.Fatal(err)
	}
	if updated.MemberID != original.MemberID || updated.Delegation != original.Delegation || updated.ClientCertificatePEM != original.ClientCertificatePEM {
		t.Fatal("endpoint update changed identity")
	}
	if err := persist(updated); err != nil {
		t.Fatal(err)
	}
	runtime.RetryNow()
	waitGatewayCondition(t, ctx, func() bool {
		return runtime.Snapshot().State == flowersec.ConnectionConnected && current().LastEndpointID == "public_new" && store.EndpointUsage()["public_new"] > 0
	})
	if len(current().ConnectionEndpoints()) != 1 || current().ConnectionEndpoints()[0] != newEndpoint {
		t.Fatal("deleted endpoint was automatically restored")
	}
}

func TestRuntimeReconnectsWhenDomainIPChanges(t *testing.T) {
	first, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = first.Close() })
	_, port, _ := net.SplitHostPort(first.Addr().String())
	second, err := net.Listen("tcp", net.JoinHostPort("::1", port))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = second.Close() })
	resolverSocket, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	var addressSuffix atomic.Uint32
	addressSuffix.Store(1)
	resolverDone := make(chan struct{})
	go func() {
		defer close(resolverDone)
		buffer := make([]byte, 4096)
		for {
			count, sender, err := resolverSocket.ReadFrom(buffer)
			if err != nil {
				return
			}
			var query dnsmessage.Message
			if query.Unpack(buffer[:count]) != nil {
				continue
			}
			answer := dnsmessage.Message{Header: dnsmessage.Header{ID: query.ID, Response: true, RecursionAvailable: true}, Questions: query.Questions}
			for _, question := range query.Questions {
				if question.Type == dnsmessage.TypeA && question.Name.String() == "gateway.acceptance.invalid." && addressSuffix.Load() == 1 {
					answer.Answers = append(answer.Answers, dnsmessage.Resource{
						Header: dnsmessage.ResourceHeader{Name: question.Name, Type: dnsmessage.TypeA, Class: dnsmessage.ClassINET},
						Body:   &dnsmessage.AResource{A: [4]byte{127, 0, 0, 1}},
					})
				}
				if question.Type == dnsmessage.TypeAAAA && question.Name.String() == "gateway.acceptance.invalid." && addressSuffix.Load() == 2 {
					answer.Answers = append(answer.Answers, dnsmessage.Resource{
						Header: dnsmessage.ResourceHeader{Name: question.Name, Type: dnsmessage.TypeAAAA, Class: dnsmessage.ClassINET},
						Body:   &dnsmessage.AAAAResource{AAAA: [16]byte{15: 1}},
					})
				}
			}
			raw, err := answer.Pack()
			if err == nil {
				_, _ = resolverSocket.WriteTo(raw, sender)
			}
		}
	}()
	previousResolver := net.DefaultResolver
	net.DefaultResolver = &net.Resolver{PreferGo: true, Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, network, resolverSocket.LocalAddr().String())
	}}
	t.Cleanup(func() { net.DefaultResolver = previousResolver; _ = resolverSocket.Close(); <-resolverDone })
	store, identity := membershipStore(t)
	store, err = NewStore(filepath.Join(t.TempDir(), "members.json"), identity, "https://gateway.acceptance.invalid:"+port, first.Addr().String(), store.hooks)
	if err != nil {
		t.Fatal(err)
	}
	connections := NewConnections(gatewayflow.New(0, 0))
	t.Cleanup(connections.Close)
	store.SetCommitHandler(connections.Apply)
	endpoint, err := NewListener(store, connections, func(string) bool { return true })
	if err != nil {
		t.Fatal(err)
	}
	trust, err := store.TLSConfig()
	if err != nil {
		t.Fatal(err)
	}
	firstServer, err := endpoint.Server(trust, nil)
	if err != nil {
		t.Fatal(err)
	}
	secondServer, err := endpoint.Server(trust, nil)
	if err != nil {
		t.Fatal(err)
	}
	firstDone, secondDone := make(chan struct{}), make(chan struct{})
	go func() { defer close(firstDone); _ = firstServer.Serve(first) }()
	go func() { defer close(secondDone); _ = secondServer.Serve(second) }()
	t.Cleanup(func() { _ = firstServer.Close(); _ = secondServer.Close(); <-firstDone; <-secondDone })
	invitation, err := store.Invite("admin")
	if err != nil {
		t.Fatal(err)
	}
	state, err := PrepareRuntime(invitation, "runtime_dns_change", gp.MemberMetadata{})
	if err != nil {
		t.Fatal(err)
	}
	var stateMu sync.Mutex
	current := func() *RuntimeConfig { stateMu.Lock(); defer stateMu.Unlock(); return state.Clone() }
	persist := func(next *RuntimeConfig) error {
		stateMu.Lock()
		defer stateMu.Unlock()
		state = next.Clone()
		return nil
	}
	runtime, err := NewRuntimeConnection(current, persist)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	runtimeDone := make(chan error, 1)
	go func() {
		runtimeDone <- runtime.Run(ctx, func(string) RuntimeApplication {
			return RuntimeApplication{Handler: http.NotFoundHandler(), WebSocketHandler: http.NotFoundHandler()}
		})
	}()
	defer func() { cancel(); <-runtimeDone }()
	waitGatewayCondition(t, ctx, func() bool {
		return runtime.Snapshot().State == flowersec.ConnectionConnected && current().LastEndpointID != ""
	})
	original := current()
	addressSuffix.Store(2)
	if err := firstServer.Close(); err != nil {
		t.Fatal(err)
	}
	waitGatewayCondition(t, ctx, func() bool {
		return runtime.Snapshot().State == flowersec.ConnectionConnected && current().LastSpentChannelID != original.LastSpentChannelID
	})
	updated := current()
	if updated.MemberID != original.MemberID || updated.ClientCertificatePEM != original.ClientCertificatePEM || updated.GatewayEndpoints[0] != original.GatewayEndpoints[0] {
		t.Fatal("DNS address change replaced membership or required new endpoints")
	}
}

func TestMemberOfferRejectsUnknownOrChangedEndpoints(t *testing.T) {
	store, _ := membershipStore(t)
	invitation, err := store.Invite("admin")
	if err != nil {
		t.Fatal(err)
	}
	member, err := PrepareRuntime(invitation, "runtime_endpoints", gp.MemberMetadata{})
	if err != nil {
		t.Fatal(err)
	}
	response, err := store.Join(t.Context(), *member.PendingJoin)
	if err != nil {
		t.Fatal(err)
	}
	member.ClientCertificatePEM = response.ClientCertificatePEM
	for _, mutate := range []func(*gp.GatewayEndpoint){
		func(endpoint *gp.GatewayEndpoint) { endpoint.EndpointID = "unknown" },
		func(endpoint *gp.GatewayEndpoint) { endpoint.Address = "https://unknown.example" },
		func(endpoint *gp.GatewayEndpoint) { endpoint.Priority++ },
	} {
		endpoint := invitation.Endpoints[0]
		mutate(&endpoint)
		if _, err := store.MemberOffer(mustClientLeaf(t, member), endpoint); !errors.Is(err, errGatewayUnavailable) {
			t.Fatal("unconfirmed endpoint accepted", err)
		}
	}
}
