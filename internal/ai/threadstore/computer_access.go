package threadstore

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/url"
	"strings"
)

// ComputerAccess is product authorization for a thread, not runtime ownership.
// Forks start with the empty database default; no permission follows history.
type ComputerAccess struct {
	Origins         []string `json:"origins"`
	Apps            []string `json:"apps"`
	AllowForeground bool     `json:"allow_foreground"`
}

func (a ComputerAccess) Validate() error {
	if len(a.Origins) > 64 || len(a.Apps) > 64 {
		return errors.New("too many computer permissions")
	}
	seen := make(map[string]bool)
	for _, origin := range a.Origins {
		u, err := url.Parse(origin)
		if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Hostname() == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || strings.ToLower(origin) != origin || seen[origin] {
			return errors.New("computer sites must be unique HTTP or HTTPS origins")
		}
		seen[origin] = true
	}
	for _, app := range a.Apps {
		if strings.TrimSpace(app) != app || len(app) < 1 || len(app) > 255 || strings.ContainsAny(app, "\x00\r\n/\\") || seen["app:"+app] {
			return errors.New("invalid computer application")
		}
		seen["app:"+app] = true
	}
	return nil
}

func (s *Store) GetComputerAccess(ctx context.Context, threadID string) (ComputerAccess, error) {
	var raw string
	if err := s.db.QueryRowContext(ctx, `SELECT computer_access_json FROM ai_thread_settings WHERE thread_id = ?`, threadID).Scan(&raw); err != nil {
		return ComputerAccess{}, err
	}
	if !strings.HasPrefix(strings.TrimSpace(raw), "{") {
		return ComputerAccess{}, errors.New("invalid computer access data")
	}
	var access ComputerAccess
	decoder := json.NewDecoder(bytes.NewBufferString(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&access); err != nil {
		return access, err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return access, errors.New("invalid computer access data")
	}
	return access, access.Validate()
}

func (s *Store) SetComputerAccess(ctx context.Context, threadID string, access ComputerAccess) error {
	if err := access.Validate(); err != nil {
		return err
	}
	body, err := json.Marshal(access)
	if err != nil {
		return err
	}
	result, err := s.db.ExecContext(ctx, `UPDATE ai_thread_settings SET computer_access_json = ? WHERE thread_id = ?`, string(body), threadID)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count != 1 {
		return errors.New("computer access thread not found")
	}
	return nil
}
