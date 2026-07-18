package agent

import (
	"context"
	"encoding/json"
	"net"
	"testing"
	"time"

	fsrpc "github.com/floegence/flowersec/flowersec-go/rpc"
)

func TestProxySessionServerKeepsBootstrapRPCStreamOpen(t *testing.T) {
	errorCh := make(chan error, 1)
	server, err := newProxySessionServer(func(err error) {
		errorCh <- err
	})
	if err != nil {
		t.Fatalf("newProxySessionServer() error = %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	serverConn, clientConn := net.Pipe()
	done := make(chan struct{})
	go func() {
		defer close(done)
		server.HandleStream(ctx, "rpc", serverConn)
	}()

	client := fsrpc.NewClient(clientConn)
	for _, typeID := range []uint32{1, 2} {
		callCtx, callCancel := context.WithTimeout(context.Background(), time.Second)
		_, rpcErr, err := client.Call(callCtx, typeID, json.RawMessage(`{}`))
		callCancel()
		if err != nil {
			t.Fatalf("bootstrap RPC call %d transport error = %v", typeID, err)
		}
		if rpcErr == nil || rpcErr.Code != 404 {
			t.Fatalf("bootstrap RPC call %d error = %#v, want code 404", typeID, rpcErr)
		}
	}

	select {
	case err := <-errorCh:
		t.Fatalf("bootstrap RPC stream reported a serve error: %v", err)
	default:
	}

	cancel()
	_ = client.Close()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("bootstrap RPC stream did not stop after cancellation")
	}
}
