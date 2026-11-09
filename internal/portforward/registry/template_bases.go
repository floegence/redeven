package registry

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
)

func applyTemplateBasesSchema(tx *sql.Tx) error {
	_, err := tx.Exec(`CREATE TABLE managed_web_service_template_bases (
 template_id TEXT PRIMARY KEY REFERENCES managed_web_service_templates(template_id) ON DELETE CASCADE,
 source_template_id TEXT NOT NULL, sha256 TEXT NOT NULL,
 FOREIGN KEY(source_template_id,sha256) REFERENCES managed_web_service_source_versions(template_id,sha256));`)
	return err
}
func migrateRegistryV7ToV8(tx *sql.Tx) error {
	if err := verifyRegistryVersion(tx, 7); err != nil {
		return err
	}
	if err := applyTemplateBasesSchema(tx); err != nil {
		return err
	}
	return verifyRegistryVersion(tx, 8)
}
func (r *Registry) GetManagedTemplateBase(ctx context.Context, id string) (*ManagedTemplateSource, error) {
	var raw, directory string
	err := r.db.QueryRowContext(nonNilContext(ctx), `SELECT v.source_json,v.directory FROM managed_web_service_template_bases b JOIN managed_web_service_source_versions v ON v.template_id=b.source_template_id AND v.sha256=b.sha256 WHERE b.template_id=?`, id).Scan(&raw, &directory)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var source ManagedTemplateSource
	if err := json.Unmarshal([]byte(raw), &source); err != nil {
		return nil, err
	}
	source.Directory = directory
	return &source, nil
}
func (r *Registry) CreateManagedTemplateWithBase(ctx context.Context, value ManagedTemplate, request ManagedTemplateRequest, base *ManagedTemplateSource) error {
	return r.createManagedTemplate(ctx, value, &request, base)
}
