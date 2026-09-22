package ai

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/session"
)

const (
	BrowserDOMStream    = "browser/dom_v1"
	BrowserInputStream  = "browser/input_v1"
	BrowserMediaStream  = "browser/media_v1"
	BrowserUploadStream = "browser/upload_v1"
)

func browserStreamRequest(reader *bufio.Reader, limit int, value any) error {
	line, err := readComputerLine(reader, limit)
	if err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(line))
	decoder.DisallowUnknownFields()
	if decoder.Decode(value) != nil || decoder.Decode(&struct{}{}) != io.EOF {
		return errBrowserViewUnavailable
	}
	return nil
}

// Flowersec owns encryption, scheduling and the environment connection. These
// independent continuous lanes carry only a Runtime-issued view identity.
// Media consumption acknowledgements never enter the target input queue.
func (r *ComputerUseRuntime) ServeBrowserStream(ctx context.Context, stream io.ReadWriteCloser, meta *session.Meta, gate *accessgate.Gate, kind string) error {
	if stream == nil {
		return errBrowserViewUnavailable
	}
	if r == nil || accessgate.RequireRPC(gate, meta, accessgate.RPCAccessProtected) != nil || requireRWX(meta) != nil {
		return json.NewEncoder(stream).Encode(map[string]any{"ok": false, "error": "browser_view_unavailable"})
	}
	if kind == BrowserUploadStream {
		return r.serveBrowserUpload(ctx, stream, meta)
	}
	ctx, cancel := context.WithCancel(ctx)
	stop := context.AfterFunc(ctx, func() { _ = stream.Close() })
	// Ending a continuous lane deliberately discards stale queued frames.
	// Finite resource/file responses use their own request lifetime.
	defer func() { cancel(); _ = stream.Close(); stop() }()
	reader := bufio.NewReader(stream)
	var request struct {
		View string `json:"view"`
	}
	if browserStreamRequest(reader, 4096, &request) != nil {
		return errBrowserViewUnavailable
	}
	view, err := r.browserView(meta, request.View)
	if err != nil {
		return err
	}
	stopView := context.AfterFunc(view.ctx, cancel)
	defer stopView()
	switch kind {
	case BrowserDOMStream:
		body, err := r.OpenBrowserObservation(ctx, meta, view.id)
		if err != nil {
			return err
		}
		defer body.Close()
		if err := json.NewEncoder(stream).Encode(map[string]bool{"ok": true}); err != nil {
			return errBrowserViewUnavailable
		}
		// Peer close cancels observation even when this page has no more changes.
		go func() { _, _ = reader.ReadByte(); cancel() }()
		_, err = io.CopyBuffer(stream, body, make([]byte, 32*1024))
		if err != nil && ctx.Err() == nil {
			return errBrowserViewUnavailable
		}
		return nil
	case BrowserInputStream:
		return r.serveBrowserInput(ctx, stream, reader, view, meta, gate)
	case BrowserMediaStream:
		response, err := view.host.request(ctx, http.MethodGet, "/media?view="+url.QueryEscape(view.id), nil)
		if err != nil {
			return errBrowserViewUnavailable
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			return errBrowserViewUnavailable
		}
		if err := json.NewEncoder(stream).Encode(map[string]bool{"ok": true}); err != nil {
			return errBrowserViewUnavailable
		}
		go func() {
			defer cancel()
			var ack [8]byte
			for {
				if _, err := io.ReadFull(reader, ack[:]); err != nil {
					return
				}
				consumedBytes := binary.BigEndian.Uint64(ack[:])
				if consumedBytes > 1<<53-1 || accessgate.RequireRPC(gate, meta, accessgate.RPCAccessProtected) != nil {
					return
				}
				if err := view.host.call(ctx, "media.ack", map[string]any{"view": view.id, "consumedBytes": consumedBytes}, nil); err != nil {
					return
				}
			}
		}()
		_, err = io.CopyBuffer(stream, response.Body, make([]byte, 32*1024))
		if err != nil && ctx.Err() == nil {
			return errBrowserViewUnavailable
		}
		return nil
	default:
		return errBrowserViewUnavailable
	}
}

func (r *ComputerUseRuntime) serveBrowserUpload(ctx context.Context, stream io.ReadWriteCloser, meta *session.Meta) error {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	stop := context.AfterFunc(ctx, func() { _ = stream.Close() })
	// The Flowersec handler owns normal FIN after this finite response. Closing
	// here would reset a successful file identity before the peer consumes it.
	defer stop()
	reader := bufio.NewReader(stream)
	var request struct {
		View, Token, Chooser, Name, RelativePath string
		Size                                     int64
	}
	if browserStreamRequest(reader, 8192, &request) != nil {
		return errBrowserViewUnavailable
	}
	view, err := r.browserView(meta, request.View)
	if err != nil {
		return err
	}
	stopView := context.AfterFunc(view.ctx, cancel)
	defer stopView()
	view.opMu.Lock()
	authorized := request.Token != "" && request.Token == view.token && view.lease != nil && view.lease.current()
	view.opMu.Unlock()
	view.mu.Lock()
	available := view.uploads < 4
	if available {
		view.uploads++
	}
	view.mu.Unlock()
	if !available {
		return errBrowserViewUnavailable
	}
	defer func() { view.mu.Lock(); view.uploads--; view.mu.Unlock() }()
	if !authorized || request.Size < 0 || request.Size > 256<<20 {
		return json.NewEncoder(stream).Encode(map[string]any{"ok": false, "error": "browser_file_unavailable"})
	}
	if err := json.NewEncoder(stream).Encode(map[string]bool{"ok": true}); err != nil {
		return err
	}
	file := BrowserUploadFile{Chooser: request.Chooser, Name: request.Name, Size: request.Size, RelativePath: request.RelativePath}
	id, err := r.UploadBrowserFile(ctx, meta, request.View, request.Token, file, io.LimitReader(reader, request.Size))
	if err != nil {
		return errBrowserViewUnavailable
	}
	return json.NewEncoder(stream).Encode(map[string]any{"ok": true, "id": id})
}

func (r *ComputerUseRuntime) serveBrowserInput(ctx context.Context, stream io.ReadWriter, reader *bufio.Reader, view *browserView, meta *session.Meta, gate *accessgate.Gate) error {
	view.mu.Lock()
	if view.input {
		view.mu.Unlock()
		return errBrowserViewUnavailable
	}
	view.input = true
	view.mu.Unlock()
	defer func() {
		view.opMu.Lock()
		cleanup, done := context.WithTimeout(context.Background(), browserInputDrainTimeout)
		_ = view.release(cleanup)
		done()
		view.opMu.Unlock()
		view.mu.Lock()
		view.input = false
		view.mu.Unlock()
	}()
	if err := json.NewEncoder(stream).Encode(map[string]bool{"ok": true}); err != nil {
		return errBrowserViewUnavailable
	}
	for {
		var input struct {
			Token   string          `json:"token"`
			Message json.RawMessage `json:"message"`
		}
		err := browserStreamRequest(reader, 70*1024, &input)
		if errors.Is(err, io.EOF) || ctx.Err() != nil {
			return nil
		}
		if err != nil || len(input.Token) > 128 || accessgate.RequireRPC(gate, meta, accessgate.RPCAccessProtected) != nil {
			return errBrowserViewUnavailable
		}
		if err := r.ReceiveBrowserView(ctx, meta, view.id, input.Token, input.Message); err != nil {
			known := errors.Is(err, errBrowserControlRevoked) || errors.Is(err, errBrowserViewUnavailable)
			code := "action_failed"
			if known {
				code = "not_allowed"
			}
			var command struct {
				Type string `json:"type"`
				ID   int64  `json:"id"`
			}
			if json.Unmarshal(input.Message, &command) != nil || command.Type != "command" {
				return errBrowserViewUnavailable
			}
			if err := json.NewEncoder(stream).Encode(map[string]any{"type": "ack", "id": command.ID, "ok": false, "code": code}); err != nil {
				return errBrowserViewUnavailable
			}
			if !known {
				return errBrowserViewUnavailable
			}
		}
	}
}
