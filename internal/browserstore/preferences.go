package browserstore

import (
	"context"
	"database/sql"
	"encoding/hex"
	"errors"
	"strings"
)

// Preference references library identity only. It carries no target, endpoint,
// command, credential or authority that could be replayed after a restart.
type Preference struct {
	ProfileID      string `json:"profile_id"`
	InstallationID string `json:"installation_id,omitempty"`
}

func (s *Store) Preference(ctx context.Context, owner string) (*Preference, error) {
	if _, err := normalizeOwner(owner); err != nil {
		return nil, err
	}
	var value Preference
	err := s.db.QueryRowContext(ctx, `SELECT profile_id,installation_id FROM browser_preferences WHERE owner_id=?`, owner).Scan(&value.ProfileID, &value.InstallationID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &value, nil
}

func (s *Store) SetPreference(ctx context.Context, owner string, value Preference) error {
	kind, err := s.requireProfile(ctx, owner, value.ProfileID)
	if err != nil {
		return err
	}
	if value.InstallationID != "" {
		id := strings.TrimPrefix(value.InstallationID, "browser-")
		if _, err := hex.DecodeString(id); err != nil || len(id) != 24 || !strings.HasPrefix(value.InstallationID, "browser-") || kind != Extension {
			return errors.New("invalid browser installation identity")
		}
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO browser_preferences(owner_id,profile_id,installation_id) VALUES(?,?,?) ON CONFLICT(owner_id) DO UPDATE SET profile_id=excluded.profile_id,installation_id=excluded.installation_id`, owner, value.ProfileID, value.InstallationID)
	return err
}
