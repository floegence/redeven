// Package stdiobridge owns the bounded HTTP/2 transport shared by bridge protocols.
package stdiobridge

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"sync"
	"time"
)

const (
	MaxConcurrentStreams      = 64
	MaxHeaderListBytes        = 8 << 10
	StreamReceiveWindowBytes  = 256 << 10
	SessionReceiveWindowBytes = 16 << 20
)

func Serve(ctx context.Context, in io.Reader, out io.Writer, handler http.Handler) error {
	if in == nil || out == nil || handler == nil {
		return errors.New("missing bridge transport")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	conn := newStdioConn(in, out)
	defer conn.Close()
	stopWatch := make(chan struct{})
	defer close(stopWatch)
	go func() {
		select {
		case <-ctx.Done():
			_ = conn.Close()
		case <-stopWatch:
		}
	}()
	protocols := new(http.Protocols)
	protocols.SetUnencryptedHTTP2(true)
	server := &http.Server{
		Protocols:      protocols,
		MaxHeaderBytes: MaxHeaderListBytes,
		BaseContext:    func(net.Listener) context.Context { return ctx },
		Handler:        handler,
		HTTP2: &http.HTTP2Config{
			MaxConcurrentStreams:          MaxConcurrentStreams,
			MaxDecoderHeaderTableSize:     4 << 10,
			MaxEncoderHeaderTableSize:     4 << 10,
			MaxReadFrameSize:              16 << 10,
			SendPingTimeout:               15 * time.Second,
			PingTimeout:                   10 * time.Second,
			WriteByteTimeout:              30 * time.Second,
			MaxReceiveBufferPerStream:     StreamReceiveWindowBytes,
			MaxReceiveBufferPerConnection: SessionReceiveWindowBytes,
		},
	}
	err := server.Serve(&stdioListener{conn: conn})
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if errors.Is(err, net.ErrClosed) || errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

type stdioConn struct {
	reader io.Reader
	writer io.Writer
	once   sync.Once
	closed chan struct{}
}

func newStdioConn(reader io.Reader, writer io.Writer) *stdioConn {
	return &stdioConn{reader: reader, writer: writer, closed: make(chan struct{})}
}

func (c *stdioConn) Read(p []byte) (int, error)       { return c.reader.Read(p) }
func (c *stdioConn) Write(p []byte) (int, error)      { return c.writer.Write(p) }
func (c *stdioConn) LocalAddr() net.Addr              { return stdioAddr("local") }
func (c *stdioConn) RemoteAddr() net.Addr             { return stdioAddr("remote") }
func (c *stdioConn) SetDeadline(time.Time) error      { return nil }
func (c *stdioConn) SetReadDeadline(time.Time) error  { return nil }
func (c *stdioConn) SetWriteDeadline(time.Time) error { return nil }
func (c *stdioConn) Close() error {
	c.once.Do(func() {
		defer close(c.closed)
		if closer, ok := c.reader.(io.Closer); ok {
			_ = closer.Close()
		}
		if closer, ok := c.writer.(io.Closer); ok {
			_ = closer.Close()
		}
	})
	return nil
}

// stdioListener hands the existing connection to net/http exactly once. It binds
// no socket and stops accepting only after that connection has closed.
type stdioListener struct {
	conn *stdioConn
	once sync.Once
}

func (l *stdioListener) Accept() (net.Conn, error) {
	var conn net.Conn
	l.once.Do(func() { conn = l.conn })
	if conn != nil {
		return conn, nil
	}
	<-l.conn.closed
	return nil, net.ErrClosed
}

func (l *stdioListener) Close() error   { return l.conn.Close() }
func (l *stdioListener) Addr() net.Addr { return l.conn.LocalAddr() }

type stdioAddr string

func (stdioAddr) Network() string  { return "stdio" }
func (a stdioAddr) String() string { return string(a) }
