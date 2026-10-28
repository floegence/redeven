package environmentcenter

import (
	"context"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"net"
	"net/http"
	"testing"
	"time"
)

func TestPrivateEgressRejectsUnknownTargetsAndUntrustedLocalClients(t *testing.T) {
	target, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer target.Close()
	accepted := make(chan net.Conn, 1)
	go func() {
		conn, err := target.Accept()
		if err == nil {
			accepted <- conn
		}
	}()
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	owner, proxy, err := newEndpointEgress(ctx, []gp.GatewayEndpoint{{Address: "https://" + target.Addr().String()}})
	if err != nil {
		t.Fatal(err)
	}
	defer owner.Close()
	attempt, stop := context.WithTimeout(ctx, 2*time.Second)
	defer stop()
	if conn, err := proxy.DialContext(attempt, "tcp", "127.0.0.1:1"); err == nil {
		conn.Close()
		t.Fatal("unregistered target accepted")
	}
	client := &http.Client{Timeout: time.Second}
	if response, err := client.Get("https://" + owner.listener.Addr().String()); err == nil {
		response.Body.Close()
		t.Fatal("untrusted local caller accepted")
	}
	conn, err := proxy.DialContext(attempt, "tcp", target.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	var upstream net.Conn
	select {
	case upstream = <-accepted:
	case <-attempt.Done():
		t.Fatal("allowed endpoint was not dialed")
	}
	defer upstream.Close()
	cancel()
	_ = conn.SetReadDeadline(time.Now().Add(time.Second))
	if _, err = conn.Read(make([]byte, 1)); err == nil {
		t.Fatal("canceled egress remains connected")
	}
}
func TestEndpointAuthorityRejectsUnregisteredURLParts(t *testing.T) {
	for _, address := range []string{"http://gateway.test", "https://user@gateway.test", "https://gateway.test/path", "https://gateway.test?secret=1", "https://gateway.test#x"} {
		if _, err := endpointAuthorities([]gp.GatewayEndpoint{{Address: address}}); err == nil {
			t.Fatalf("accepted %s", address)
		}
	}
}
