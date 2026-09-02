package registry

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

type ManagedReleaseCheck struct {
	ServiceID         string
	SummaryJSON       string
	SummarySHA256     string
	CheckedAtUnixMs   int64
	NextCheckAtUnixMs int64
	Stale             bool
	LastErrorCode     string
	UpdatedAtUnixMs   int64
}

func (r *Registry) GetManagedReleaseCheck(ctx context.Context, serviceID string) (*ManagedReleaseCheck, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("registry not initialized")
	}
	value := ManagedReleaseCheck{}
	var stale int
	err := r.db.QueryRowContext(nonNilContext(ctx), `SELECT service_id,summary_json,summary_sha256,checked_at_unix_ms,next_check_at_unix_ms,stale,last_error_code,updated_at_unix_ms FROM managed_web_service_release_checks WHERE service_id=?`, strings.TrimSpace(serviceID)).Scan(
		&value.ServiceID, &value.SummaryJSON, &value.SummarySHA256, &value.CheckedAtUnixMs, &value.NextCheckAtUnixMs, &stale, &value.LastErrorCode, &value.UpdatedAtUnixMs,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	value.Stale = stale != 0
	if err := verifyDocumentDigest("release check", value.ServiceID, value.SummaryJSON, value.SummarySHA256); err != nil {
		return nil, err
	}
	return &value, nil
}

func (r *Registry) UpsertManagedReleaseCheck(ctx context.Context, value ManagedReleaseCheck) error {
	if r == nil || r.db == nil {
		return errors.New("registry not initialized")
	}
	value.ServiceID = strings.TrimSpace(value.ServiceID)
	value.SummaryJSON = strings.TrimSpace(value.SummaryJSON)
	value.SummarySHA256 = strings.TrimSpace(value.SummarySHA256)
	value.LastErrorCode = strings.TrimSpace(value.LastErrorCode)
	if value.ServiceID == "" || value.CheckedAtUnixMs <= 0 || value.NextCheckAtUnixMs <= 0 {
		return errors.New("managed release check is incomplete")
	}
	if err := verifyDocumentDigest("release check", value.ServiceID, value.SummaryJSON, value.SummarySHA256); err != nil {
		return err
	}
	if value.UpdatedAtUnixMs <= 0 {
		value.UpdatedAtUnixMs = time.Now().UnixMilli()
	}
	_, err := r.db.ExecContext(nonNilContext(ctx), `INSERT INTO managed_web_service_release_checks(service_id,summary_json,summary_sha256,checked_at_unix_ms,next_check_at_unix_ms,stale,last_error_code,updated_at_unix_ms) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(service_id) DO UPDATE SET summary_json=excluded.summary_json,summary_sha256=excluded.summary_sha256,checked_at_unix_ms=excluded.checked_at_unix_ms,next_check_at_unix_ms=excluded.next_check_at_unix_ms,stale=excluded.stale,last_error_code=excluded.last_error_code,updated_at_unix_ms=excluded.updated_at_unix_ms`,
		value.ServiceID, value.SummaryJSON, value.SummarySHA256, value.CheckedAtUnixMs, value.NextCheckAtUnixMs, boolToInt(value.Stale), value.LastErrorCode, value.UpdatedAtUnixMs,
	)
	return err
}

func (r *Registry) MarkManagedReleaseCheckStale(ctx context.Context, serviceID, errorCode string, nextCheckAtUnixMs int64) error {
	if r == nil || r.db == nil {
		return errors.New("registry not initialized")
	}
	_, err := r.db.ExecContext(nonNilContext(ctx), `UPDATE managed_web_service_release_checks SET stale=1,last_error_code=?,next_check_at_unix_ms=?,updated_at_unix_ms=? WHERE service_id=?`, strings.TrimSpace(errorCode), nextCheckAtUnixMs, time.Now().UnixMilli(), strings.TrimSpace(serviceID))
	return err
}
