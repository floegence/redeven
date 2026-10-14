package ai

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"unicode/utf8"

	"github.com/floegence/floret/v7/identity"
	"github.com/floegence/redeven/internal/session"
)

// ThreadReferenceSnapshot is frozen user-supplied information, never authority
// or a live projection. The target is authorized only on first admission.
type ThreadReferenceSnapshot struct {
	RuntimeID    string `json:"runtime_id"`
	ThreadID     string `json:"thread_id"`
	Title        string `json:"title"`
	Status       string `json:"status"`
	WorkingDir   string `json:"working_dir"`
	CreatedAtMs  int64  `json:"created_at_ms"`
	UpdatedAtMs  int64  `json:"updated_at_ms"`
	CapturedAtMs int64  `json:"captured_at_ms"`
}

func (snapshot *ThreadReferenceSnapshot) UnmarshalJSON(raw []byte) error {
	type wire ThreadReferenceSnapshot
	var value wire
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(&value); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return err
	}
	if len(fields) != 8 {
		return ErrInvalidContextAction
	}
	*snapshot = ThreadReferenceSnapshot(value)
	if !snapshot.valid() {
		return ErrInvalidContextAction
	}
	return nil
}

func (snapshot ThreadReferenceSnapshot) valid() bool {
	if _, err := identity.ParseThreadID(snapshot.ThreadID); err != nil {
		return false
	}
	for _, value := range []string{snapshot.RuntimeID, snapshot.ThreadID, snapshot.Title, snapshot.Status, snapshot.WorkingDir} {
		if !utf8.ValidString(value) || len(value) > 8192 || strings.ContainsAny(value, "\x00\r\n") {
			return false
		}
	}
	if snapshot.RuntimeID == "" || snapshot.RuntimeID != strings.TrimSpace(snapshot.RuntimeID) || snapshot.Status == "" {
		return false
	}
	for _, value := range []int64{snapshot.CreatedAtMs, snapshot.UpdatedAtMs, snapshot.CapturedAtMs} {
		if value <= 0 || value > 9007199254740991 {
			return false
		}
	}
	return true
}

func (s *Service) authorizeThreadReferences(ctx context.Context, meta *session.Meta, action *ContextActionEnvelope) error {
	normalized, err := normalizeAskFlowerContextActionEnvelope(action)
	if err != nil || normalized == nil {
		return err
	}
	for _, item := range normalized.Context {
		if item.Kind != contextActionKindThread {
			continue
		}
		if meta == nil || item.Thread.RuntimeID != flowerThreadReferenceRuntimeID(meta.EndpointID) {
			return errReadPermissionDenied
		}
		settings, err := s.threadSettingsForRead(ctx, meta, item.Thread.ThreadID)
		if err != nil {
			return err
		}
		if settings == nil {
			return sql.ErrNoRows
		}
	}
	return nil
}

func flowerThreadReferenceRuntimeID(endpointID string) string {
	endpointID = strings.TrimSpace(endpointID)
	if endpointID == "env_local" {
		return "env:local-environment"
	}
	return "env:" + endpointID
}
