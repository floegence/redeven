// Package browserbridge contains Redeven's local Chrome Native Messaging wire.
// It carries closed product commands; it never authorizes or evaluates scripts.
package browserbridge

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"time"
)

const MaxMessageBytes = 24 << 20

func ReadMessage(reader io.Reader, limit uint32) (json.RawMessage, error) {
	var header [4]byte
	if _, err := io.ReadFull(reader, header[:]); err != nil {
		return nil, err
	}
	length := binary.LittleEndian.Uint32(header[:])
	if length == 0 || length > limit {
		return nil, errors.New("browser message exceeds its limit")
	}
	body := make([]byte, length)
	if _, err := io.ReadFull(reader, body); err != nil {
		return nil, err
	}
	if !json.Valid(body) {
		return nil, errors.New("invalid browser message")
	}
	return body, nil
}

func WriteMessage(writer io.Writer, value any, limit uint32) error {
	body, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if len(body) == 0 || len(body) > int(limit) {
		return errors.New("browser message exceeds its limit")
	}
	header := make([]byte, 4)
	binary.LittleEndian.PutUint32(header, uint32(len(body)))
	return writeAll(writer, append(header, body...))
}
func writeAll(writer io.Writer, data []byte) error {
	for len(data) > 0 {
		n, err := writer.Write(data)
		if err != nil {
			return err
		}
		if n == 0 {
			return io.ErrShortWrite
		}
		data = data[n:]
	}
	return nil
}

// Forward is a local byte relay. Chrome starts it from a manifest whose sole
// allowed origin is the packaged extension. No HTTP port or remote routing is
// involved; the Runtime owns the private Unix socket and every target grant.
func Forward(ctx context.Context, socket, origin string, input io.Reader, output io.Writer) error {
	if origin != "chrome-extension://"+ExtensionID+"/" || !filepath.IsAbs(socket) {
		return errors.New("browser bridge origin is not allowed")
	}
	info, err := os.Lstat(filepath.Dir(socket))
	if err != nil || !info.IsDir() || info.Mode().Perm()&0077 != 0 {
		return errors.New("browser bridge socket directory is not private")
	}
	conn, err := (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, "unix", socket)
	if err != nil {
		return errors.New("local browser runtime is unavailable")
	}
	defer conn.Close()
	stop := context.AfterFunc(ctx, func() { _ = conn.Close() })
	defer stop()
	if err := WriteMessage(conn, map[string]any{"type": "native_host", "protocol_version": ProtocolVersion, "extension_id": ExtensionID}, 1<<20); err != nil {
		return err
	}
	done := make(chan error, 2)
	go func() {
		for {
			body, err := ReadMessage(input, MaxMessageBytes)
			if err != nil {
				done <- err
				return
			}
			if err = WriteMessage(conn, body, MaxMessageBytes); err != nil {
				done <- err
				return
			}
		}
	}()
	go func() {
		// Chrome limits native-host output messages to 1 MiB. Model commands and
		// grants are much smaller; large screenshots travel in the opposite direction.
		for {
			body, err := ReadMessage(conn, 1<<20)
			if err != nil {
				done <- err
				return
			}
			if err = WriteMessage(output, body, 1<<20); err != nil {
				done <- err
				return
			}
		}
	}()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case err := <-done:
		if errors.Is(err, io.EOF) {
			return nil
		}
		return err
	}
}
