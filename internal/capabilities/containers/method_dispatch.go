package containers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

var ErrInvalidSchemaVersion = errors.New("container schema_version is invalid")

func (a *Adapter) CallMethod(ctx context.Context, method Method, request json.RawMessage) (any, error) {
	switch method {
	case MethodStatus:
		var req StatusRequest
		if err := decodeMethodRequest(request, &req); err != nil {
			return nil, err
		}
		return a.Status(ctx, req)
	case MethodList:
		var req ContainerListRequest
		if err := decodeMethodRequest(request, &req); err != nil {
			return nil, err
		}
		return a.List(ctx, req)
	case MethodInspect:
		var req ContainerInspectRequest
		if err := decodeMethodRequest(request, &req); err != nil {
			return nil, err
		}
		return a.Inspect(ctx, req)
	case MethodStartPreflight:
		var req ContainerStartRequest
		if err := decodeMethodRequest(request, &req); err != nil {
			return nil, err
		}
		return a.StartPreflight(ctx, req)
	case MethodStart:
		var req ContainerStartRequest
		if err := decodeMethodRequest(request, &req); err != nil {
			return nil, err
		}
		return a.Start(ctx, req)
	case MethodStop:
		var req ContainerActionRequest
		if err := decodeMethodRequest(request, &req); err != nil {
			return nil, err
		}
		return a.Stop(ctx, req)
	case MethodRestart:
		var req ContainerActionRequest
		if err := decodeMethodRequest(request, &req); err != nil {
			return nil, err
		}
		return a.Restart(ctx, req)
	case MethodRemove:
		var req ContainerActionRequest
		if err := decodeMethodRequest(request, &req); err != nil {
			return nil, err
		}
		return a.Remove(ctx, req)
	case MethodLogsTail:
		var req LogsTailRequest
		if err := decodeMethodRequest(request, &req); err != nil {
			return nil, err
		}
		return a.TailLogs(ctx, req)
	case MethodImagesPull:
		var req ImagePullRequest
		if err := decodeMethodRequest(request, &req); err != nil {
			return nil, err
		}
		return a.PullImage(ctx, req)
	default:
		return nil, fmt.Errorf("%w: %q", ErrInvalidMethod, method)
	}
}

func decodeMethodRequest(raw json.RawMessage, dst any) error {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 {
		return errors.New("request body is required")
	}
	var schema struct {
		SchemaVersion string `json:"schema_version"`
	}
	if err := json.Unmarshal(raw, &schema); err != nil {
		return fmt.Errorf("decode request schema_version: %w", err)
	}
	if strings.TrimSpace(schema.SchemaVersion) != SchemaVersion {
		return fmt.Errorf("%w: %q", ErrInvalidSchemaVersion, schema.SchemaVersion)
	}
	return decodeClosedRequest(raw, dst)
}

func decodeClosedRequest(raw []byte, dst any) error {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return fmt.Errorf("decode request: %w", err)
	}
	var trailing any
	if err := dec.Decode(&trailing); !errors.Is(err, io.EOF) {
		return errors.New("request body must contain one JSON object")
	}
	return nil
}
