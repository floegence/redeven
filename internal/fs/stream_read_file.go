package fs

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"strings"

	"github.com/floegence/flowersec/flowersec-go/rpc/frame"
	"github.com/floegence/redeven-agent/internal/session"
)

// ServeReadFileStream implements the `fs/read_file` stream.
//
// Protocol (after StreamHello):
//  1. Client -> Agent: fs_read_file_meta (length-prefixed JSON frame)
//  2. Agent -> Client: fs_read_file_resp_meta (length-prefixed JSON frame)
//  3. Agent -> Client: raw file bytes (length = content_len), then close
func (s *Service) ServeReadFileStream(ctx context.Context, stream io.ReadWriteCloser, meta *session.Meta) {
	if stream == nil {
		return
	}
	defer func() { _ = stream.Close() }()

	// Enforce permissions from session_meta.
	if meta == nil || !meta.CanReadFiles {
		_ = frame.WriteJSONFrame(stream, fsReadFileStreamRespMeta{
			Ok: false,
			Error: &fsStreamError{
				Code:    403,
				Message: "read permission denied",
			},
		})
		return
	}

	reqBytes, err := frame.ReadJSONFrame(stream, frame.DefaultMaxJSONFrameBytes)
	if err != nil {
		// Peer may have closed early; nothing useful to do here.
		return
	}

	var req fsReadFileStreamMeta
	if err := json.Unmarshal(reqBytes, &req); err != nil {
		_ = frame.WriteJSONFrame(stream, fsReadFileStreamRespMeta{
			Ok: false,
			Error: &fsStreamError{
				Code:    400,
				Message: "invalid request",
			},
		})
		return
	}

	req.Path = strings.TrimSpace(req.Path)
	if req.Path == "" {
		_ = frame.WriteJSONFrame(stream, fsReadFileStreamRespMeta{
			Ok: false,
			Error: &fsStreamError{
				Code:    400,
				Message: "missing path",
			},
		})
		return
	}

	_, realPath, err := s.resolve(req.Path)
	if err != nil {
		_ = frame.WriteJSONFrame(stream, fsReadFileStreamRespMeta{
			Ok: false,
			Error: &fsStreamError{
				Code:    400,
				Message: "invalid path",
			},
		})
		return
	}

	f, err := os.Open(realPath)
	if err != nil {
		_ = frame.WriteJSONFrame(stream, fsReadFileStreamRespMeta{
			Ok: false,
			Error: &fsStreamError{
				Code:    404,
				Message: "not found",
			},
		})
		return
	}
	defer func() { _ = f.Close() }()

	info, err := f.Stat()
	if err != nil {
		_ = frame.WriteJSONFrame(stream, fsReadFileStreamRespMeta{
			Ok: false,
			Error: &fsStreamError{
				Code:    500,
				Message: "stat failed",
			},
		})
		return
	}

	fileSize := info.Size()
	offset := req.Offset
	if offset < 0 {
		offset = 0
	}
	if offset > fileSize {
		_ = frame.WriteJSONFrame(stream, fsReadFileStreamRespMeta{
			Ok: false,
			Error: &fsStreamError{
				Code:    416,
				Message: "offset out of range",
			},
		})
		return
	}

	if offset > 0 {
		if _, err := f.Seek(offset, io.SeekStart); err != nil {
			_ = frame.WriteJSONFrame(stream, fsReadFileStreamRespMeta{
				Ok: false,
				Error: &fsStreamError{
					Code:    500,
					Message: "seek failed",
				},
			})
			return
		}
	}

	contentLen := fileSize - offset
	truncated := false
	if req.MaxBytes > 0 && contentLen > req.MaxBytes {
		contentLen = req.MaxBytes
		truncated = true
	}
	if contentLen < 0 {
		contentLen = 0
	}

	if err := frame.WriteJSONFrame(stream, fsReadFileStreamRespMeta{
		Ok:         true,
		FileSize:   fileSize,
		ContentLen: contentLen,
		Truncated:  truncated,
	}); err != nil {
		return
	}

	if contentLen == 0 {
		return
	}

	if err := copyNWithContext(ctx, stream, f, contentLen); err != nil {
		// If the client cancels (RST/FIN), writes will fail. No need to send another meta frame.
		return
	}
}

type fsReadFileStreamMeta struct {
	Path     string `json:"path"`
	Offset   int64  `json:"offset,omitempty"`
	MaxBytes int64  `json:"max_bytes,omitempty"`
}

type fsReadFileStreamRespMeta struct {
	Ok         bool           `json:"ok"`
	FileSize   int64          `json:"file_size,omitempty"`
	ContentLen int64          `json:"content_len,omitempty"`
	Truncated  bool           `json:"truncated,omitempty"`
	Error      *fsStreamError `json:"error,omitempty"`
}

type fsStreamError struct {
	Code    int    `json:"code"`
	Message string `json:"message,omitempty"`
}

func copyNWithContext(ctx context.Context, dst io.Writer, src io.Reader, n int64) error {
	if n <= 0 {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}

	buf := make([]byte, 32*1024)
	remaining := n
	for remaining > 0 {
		if err := ctx.Err(); err != nil {
			return err
		}

		want := len(buf)
		if int64(want) > remaining {
			want = int(remaining)
		}

		nr, er := src.Read(buf[:want])
		if nr > 0 {
			nw, ew := dst.Write(buf[:nr])
			if ew != nil {
				return ew
			}
			if nw != nr {
				return errors.New("short write")
			}
			remaining -= int64(nw)
		}
		if er != nil {
			if errors.Is(er, io.EOF) && remaining == 0 {
				return nil
			}
			return er
		}
	}
	return nil
}
