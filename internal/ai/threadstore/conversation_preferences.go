package threadstore

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// ConversationPreferenceScope is a product identity, never a thread/session ID.
type ConversationPreferenceScope struct {
	NamespacePublicID string
	EndpointID        string
	UserPublicID      string
}

type ConversationPreferences struct {
	ModelID          string
	WorkingDir       string
	ReasoningByModel map[string]string
	Revision         int64
}

type ModelReasoningPreference struct {
	ModelID       string
	SelectionJSON string
}

type ConversationPreferencePatch struct {
	ExpectedRevision int64
	ModelID          *string
	WorkingDir       *string
	Reasoning        *ModelReasoningPreference
}

var ErrConversationPreferenceConflict = errors.New("conversation preferences changed; reload and select again")

func (s ConversationPreferenceScope) validate() error {
	if strings.TrimSpace(s.NamespacePublicID) == "" || strings.TrimSpace(s.EndpointID) == "" || strings.TrimSpace(s.UserPublicID) == "" {
		return errors.New("missing authenticated conversation preference scope")
	}
	return nil
}

func readConversationPreferences(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, scope ConversationPreferenceScope) (ConversationPreferences, error) {
	p := ConversationPreferences{ReasoningByModel: map[string]string{}}
	var reasoningJSON string
	err := q.QueryRowContext(ctx, `SELECT model_id, working_dir, reasoning_by_model_json, revision FROM ai_conversation_preferences WHERE namespace_public_id = ? AND endpoint_id = ? AND user_public_id = ?`, scope.NamespacePublicID, scope.EndpointID, scope.UserPublicID).Scan(&p.ModelID, &p.WorkingDir, &reasoningJSON, &p.Revision)
	if errors.Is(err, sql.ErrNoRows) {
		return p, nil
	}
	if err != nil {
		return p, err
	}
	if err := json.Unmarshal([]byte(reasoningJSON), &p.ReasoningByModel); err != nil {
		return p, fmt.Errorf("decode conversation preferences: %w", err)
	}
	if p.ReasoningByModel == nil {
		p.ReasoningByModel = map[string]string{}
	}
	return p, nil
}

func (s *Store) GetConversationPreferences(ctx context.Context, scope ConversationPreferenceScope) (ConversationPreferences, error) {
	if err := scope.validate(); err != nil {
		return ConversationPreferences{}, err
	}
	return readConversationPreferences(ctx, s.db, scope)
}

// PatchConversationPreferences atomically merges only explicitly selected fields.
// A revision check prevents late browser writes from silently overwriting a newer choice.
func (s *Store) PatchConversationPreferences(ctx context.Context, scope ConversationPreferenceScope, patch ConversationPreferencePatch) (ConversationPreferences, error) {
	if err := scope.validate(); err != nil {
		return ConversationPreferences{}, err
	}
	if patch.ExpectedRevision < 0 || (patch.ModelID == nil && patch.WorkingDir == nil && patch.Reasoning == nil) {
		return ConversationPreferences{}, errors.New("invalid conversation preference patch")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return ConversationPreferences{}, err
	}
	defer tx.Rollback()
	current, err := readConversationPreferences(ctx, tx, scope)
	if err != nil {
		return current, err
	}
	if current.Revision != patch.ExpectedRevision {
		return current, ErrConversationPreferenceConflict
	}
	if patch.ModelID != nil {
		current.ModelID = *patch.ModelID
	}
	if patch.WorkingDir != nil {
		current.WorkingDir = *patch.WorkingDir
	}
	if patch.Reasoning != nil {
		current.ReasoningByModel[patch.Reasoning.ModelID] = patch.Reasoning.SelectionJSON
	}
	body, err := json.Marshal(current.ReasoningByModel)
	if err != nil {
		return current, err
	}
	current.Revision++
	result, err := tx.ExecContext(ctx, `INSERT INTO ai_conversation_preferences(namespace_public_id, endpoint_id, user_public_id, model_id, working_dir, reasoning_by_model_json, revision)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(namespace_public_id, endpoint_id, user_public_id) DO UPDATE SET model_id = excluded.model_id, working_dir = excluded.working_dir, reasoning_by_model_json = excluded.reasoning_by_model_json, revision = excluded.revision WHERE ai_conversation_preferences.revision = ?`, scope.NamespacePublicID, scope.EndpointID, scope.UserPublicID, current.ModelID, current.WorkingDir, string(body), current.Revision, patch.ExpectedRevision)
	if err != nil {
		return current, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return current, err
	}
	if affected != 1 {
		return current, ErrConversationPreferenceConflict
	}
	if err := tx.Commit(); err != nil {
		return current, err
	}
	return current, nil
}

func createConversationPreferencesTableTx(tx *sql.Tx) error {
	_, err := tx.Exec(`CREATE TABLE ai_conversation_preferences (
 namespace_public_id TEXT NOT NULL,
 endpoint_id TEXT NOT NULL,
 user_public_id TEXT NOT NULL,
 model_id TEXT NOT NULL DEFAULT '',
 working_dir TEXT NOT NULL DEFAULT '',
 reasoning_by_model_json TEXT NOT NULL DEFAULT '{}',
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
 PRIMARY KEY(namespace_public_id, endpoint_id, user_public_id)
);`)
	return err
}

func migrateThreadstoreV10ToV11(tx *sql.Tx) error {
	if err := verifyProductSchemaVersion(tx, 10); err != nil {
		return err
	}
	if err := createConversationPreferencesTableTx(tx); err != nil {
		return err
	}
	return verifyProductSchemaVersion(tx, 11)
}
