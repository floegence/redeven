package environmentcenter

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

type ownerKey struct{}

// ServeOwner exposes only named local recovery actions after OS peer validation.
// Network Origin, bearer headers, loopback addresses, and SSH variables confer no authority.
func (c *Center) ServeOwner(ctx context.Context, dir string) error {
	path := filepath.Join(dir, "owner.sock")
	if info, err := os.Lstat(path); err == nil {
		if info.Mode()&os.ModeSocket == 0 {
			return errors.New("unsafe Center owner socket")
		}
		if err = os.Remove(path); err != nil {
			return err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	listener, err := net.Listen("unix", path)
	if err != nil {
		return err
	}
	defer listener.Close()
	defer os.Remove(path)
	if err = os.Chmod(path, 0600); err != nil {
		return err
	}
	server := &http.Server{ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second, MaxHeaderBytes: 8192, ConnContext: func(ctx context.Context, conn net.Conn) context.Context {
		return context.WithValue(ctx, ownerKey{}, authorizedPeer(conn))
	}, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		trusted, _ := r.Context().Value(ownerKey{}).(bool)
		if !trusted || r.Method != "POST" || r.Header.Get("Origin") != "" || r.Header.Get("Authorization") != "" {
			http.Error(w, "Owner authorization required", 403)
			return
		}
		var request struct {
			Action string `json:"action"`
		}
		r.Body = http.MaxBytesReader(w, r.Body, 1024)
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if decoder.Decode(&request) != nil || decoder.Decode(new(any)) != io.EOF {
			http.Error(w, "Invalid request", 400)
			return
		}
		if r.URL.Path != "/owner/setup" || (request.Action != "setup" && request.Action != "recover") {
			http.NotFound(w, r)
			return
		}
		token, err := c.OwnerBootstrap(request.Action == "recover")
		writeJSON(w, map[string]string{"setup_token": token}, err)
	})}
	detach := context.AfterFunc(ctx, func() { _ = server.Close() })
	defer detach()
	err = server.Serve(listener)
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}
