package desktopbridge

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

const (
	ProtocolVersion = "redeven-desktop-bridge-v1"

	FrameTypeHello           = "hello"
	FrameTypeStreamOpen      = "stream_open"
	FrameTypeStreamData      = "stream_data"
	FrameTypeStreamClose     = "stream_close"
	FrameTypeStreamError     = "stream_error"
	FrameTypeShutdownRuntime = "shutdown_runtime"
	FrameTypePing            = "ping"
	FrameTypePong            = "pong"
)

const (
	maxHeaderBytes  = 1 << 20
	MaxPayloadBytes = 16 << 20
)

type FrameHeader struct {
	ProtocolVersion string `json:"protocol_version"`
	StreamID        string `json:"stream_id"`
	Type            string `json:"type"`
	PayloadBytes    int64  `json:"payload_bytes,omitempty"`
}

type Hello struct {
	ProtocolVersion string         `json:"protocol_version"`
	RuntimeVersion  string         `json:"runtime_version"`
	RuntimeCommit   string         `json:"runtime_commit,omitempty"`
	LocalUI         HelloLocalUI   `json:"local_ui"`
	RuntimeControl  RuntimeControl `json:"runtime_control"`
	RuntimeService  any            `json:"runtime_service"`
}

type HelloLocalUI struct {
	Available bool   `json:"available"`
	BasePath  string `json:"base_path"`
}

type RuntimeControl struct {
	Available       bool   `json:"available"`
	ProtocolVersion string `json:"protocol_version,omitempty"`
	BaseURL         string `json:"base_url,omitempty"`
	Token           string `json:"token,omitempty"`
	DesktopOwnerID  string `json:"desktop_owner_id,omitempty"`
}

type StreamSurface string

const (
	StreamSurfaceLocalUI        StreamSurface = "local_ui"
	StreamSurfaceRuntimeControl StreamSurface = "runtime_control"
)

type StreamOpen struct {
	Surface StreamSurface `json:"surface"`
}

type StreamError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func NormalizeFrameHeader(header FrameHeader) (FrameHeader, error) {
	header.ProtocolVersion = strings.TrimSpace(header.ProtocolVersion)
	header.StreamID = strings.TrimSpace(header.StreamID)
	header.Type = strings.TrimSpace(header.Type)
	if header.ProtocolVersion != ProtocolVersion {
		return FrameHeader{}, fmt.Errorf("unsupported protocol version %q", header.ProtocolVersion)
	}
	if header.Type == "" {
		return FrameHeader{}, errors.New("missing frame type")
	}
	if header.PayloadBytes < 0 {
		return FrameHeader{}, errors.New("payload_bytes must not be negative")
	}
	if header.PayloadBytes > MaxPayloadBytes {
		return FrameHeader{}, fmt.Errorf("payload too large: %d", header.PayloadBytes)
	}
	return header, nil
}

func WriteFrame(w io.Writer, header FrameHeader, payload []byte) error {
	if w == nil {
		return errors.New("missing frame writer")
	}
	header.ProtocolVersion = ProtocolVersion
	header.PayloadBytes = int64(len(payload))
	headerJSON, err := json.Marshal(header)
	if err != nil {
		return err
	}
	if len(headerJSON) > maxHeaderBytes {
		return errors.New("bridge frame header is too large")
	}
	var prefix [8]byte
	putUint32(prefix[:4], uint32(len(headerJSON)))
	putUint32(prefix[4:], uint32(len(payload)))
	if _, err := w.Write(prefix[:]); err != nil {
		return err
	}
	if _, err := w.Write(headerJSON); err != nil {
		return err
	}
	if len(payload) > 0 {
		if _, err := w.Write(payload); err != nil {
			return err
		}
	}
	return nil
}

func ReadFrame(r io.Reader) (FrameHeader, []byte, error) {
	if r == nil {
		return FrameHeader{}, nil, errors.New("missing frame reader")
	}
	var prefix [8]byte
	if _, err := io.ReadFull(r, prefix[:]); err != nil {
		return FrameHeader{}, nil, err
	}
	headerLen := int(readUint32(prefix[:4]))
	payloadLen := int(readUint32(prefix[4:]))
	if headerLen <= 0 || headerLen > maxHeaderBytes {
		return FrameHeader{}, nil, fmt.Errorf("invalid frame header length %d", headerLen)
	}
	if payloadLen < 0 || payloadLen > MaxPayloadBytes {
		return FrameHeader{}, nil, fmt.Errorf("invalid frame payload length %d", payloadLen)
	}
	headerBytes := make([]byte, headerLen)
	if _, err := io.ReadFull(r, headerBytes); err != nil {
		return FrameHeader{}, nil, err
	}
	var header FrameHeader
	if err := json.Unmarshal(headerBytes, &header); err != nil {
		return FrameHeader{}, nil, err
	}
	header, err := NormalizeFrameHeader(header)
	if err != nil {
		return FrameHeader{}, nil, err
	}
	if int64(payloadLen) != header.PayloadBytes {
		return FrameHeader{}, nil, errors.New("frame payload length does not match header")
	}
	payload := make([]byte, payloadLen)
	if payloadLen > 0 {
		if _, err := io.ReadFull(r, payload); err != nil {
			return FrameHeader{}, nil, err
		}
	}
	return header, payload, nil
}

func putUint32(dst []byte, value uint32) {
	dst[0] = byte(value >> 24)
	dst[1] = byte(value >> 16)
	dst[2] = byte(value >> 8)
	dst[3] = byte(value)
}

func readUint32(src []byte) uint32 {
	return uint32(src[0])<<24 | uint32(src[1])<<16 | uint32(src[2])<<8 | uint32(src[3])
}
