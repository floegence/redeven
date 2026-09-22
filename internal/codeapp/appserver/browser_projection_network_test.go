package appserver

import (
	"io"
	"net"
	"sync"
	"testing"
	"time"
)

func TestBrowserQualificationNetwork(t *testing.T) {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	server := make(chan error, 1)
	go func() {
		connection, err := (browserQualificationNetwork{listener}).Accept()
		if err != nil {
			server <- err
			return
		}
		defer connection.Close()
		_, err = io.Copy(connection, connection)
		server <- err
	}()
	client, err := net.DialTimeout("tcp", listener.Addr().String(), time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	_ = client.SetDeadline(time.Now().Add(10 * time.Second))
	for i := 0; i < 3; i++ {
		start := time.Now()
		if _, err := client.Write([]byte{1}); err != nil {
			t.Fatal(err)
		}
		if _, err := io.ReadFull(client, make([]byte, 1)); err != nil {
			t.Fatal(err)
		}
		if elapsed := time.Since(start); elapsed < 80*time.Millisecond || elapsed > 300*time.Millisecond {
			t.Fatalf("unexpected shaped RTT: %s", elapsed)
		}
	}
	start := time.Now()
	sent := make(chan error, 1)
	go func() { _, err := client.Write(make([]byte, 1024*1024)); sent <- err }()
	if _, err := io.CopyN(io.Discard, client, 1024*1024); err != nil {
		t.Fatal(err)
	}
	if err := <-sent; err != nil {
		t.Fatal(err)
	}
	if elapsed := time.Since(start); elapsed < 800*time.Millisecond || elapsed > 2*time.Second {
		t.Fatalf("unexpected shaped 1 MiB transfer: %s", elapsed)
	}
	_ = client.Close()
	if err := <-server; err != nil {
		t.Fatal(err)
	}
}

// This fixture shapes the actual encrypted socket in both directions. Packet
// serialization and propagation are pipelined: 40 ms one-way latency must not
// become an extra 40 ms stall per packet. Queues stay bounded under congestion.
type browserQualificationNetwork struct{ net.Listener }

func (l browserQualificationNetwork) Accept() (net.Conn, error) {
	remote, err := l.Listener.Accept()
	if err != nil {
		return nil, err
	}
	if tcp, ok := remote.(*net.TCPConn); ok {
		_ = tcp.SetReadBuffer(32 * 1024)
		_ = tcp.SetWriteBuffer(32 * 1024)
	}
	app, relay := net.Pipe()
	done := make(chan struct{})
	var once sync.Once
	closeAll := func() { once.Do(func() { close(done); _ = remote.Close(); _ = relay.Close() }) }
	forward := func(destination io.Writer, source io.Reader) {
		type packet struct {
			data []byte
			at   time.Time
		}
		packets := make(chan packet, 8)
		go func() {
			defer close(packets)
			var departure time.Time
			for {
				bytes := make([]byte, 16*1024)
				n, err := source.Read(bytes)
				if n > 0 {
					now := time.Now()
					if departure.Before(now) {
						departure = now
					}
					departure = departure.Add(time.Duration(n) * time.Second / 1250000)
					select {
					case packets <- packet{bytes[:n], departure.Add(40 * time.Millisecond)}:
					case <-done:
						return
					}
				}
				if err != nil {
					return
				}
			}
		}()
		defer closeAll()
		for packet := range packets {
			if delay := time.Until(packet.at); delay > 0 {
				timer := time.NewTimer(delay)
				select {
				case <-timer.C:
				case <-done:
					timer.Stop()
					return
				}
			}
			if _, err := destination.Write(packet.data); err != nil {
				return
			}
		}
	}
	go forward(remote, relay)
	go forward(relay, remote)
	return app, nil
}
