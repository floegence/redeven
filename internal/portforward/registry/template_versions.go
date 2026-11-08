package registry

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
)

func applyTemplateVersionsSchema(tx *sql.Tx) error {
	_, err := tx.Exec(`CREATE TABLE managed_web_service_source_versions (
 template_id TEXT NOT NULL, sha256 TEXT NOT NULL CHECK(length(sha256)=64), source_json TEXT NOT NULL CHECK(json_valid(source_json)), directory TEXT NOT NULL UNIQUE CHECK(length(directory) BETWEEN 1 AND 128 AND directory NOT GLOB '*[^a-zA-Z0-9_-]*'),
 PRIMARY KEY(template_id,sha256));
 CREATE TABLE managed_web_service_source_bindings (
 service_id TEXT PRIMARY KEY REFERENCES managed_web_services(service_id) ON DELETE CASCADE,
 template_id TEXT NOT NULL, sha256 TEXT NOT NULL, verified INTEGER NOT NULL CHECK(verified IN (0,1)),
 FOREIGN KEY(template_id,sha256) REFERENCES managed_web_service_source_versions(template_id,sha256));
 CREATE TRIGGER bind_managed_service_source AFTER INSERT ON managed_web_services BEGIN
 INSERT INTO managed_web_service_source_bindings(service_id,template_id,sha256,verified) SELECT new.service_id,template_id,sha256,1 FROM managed_web_service_template_sources WHERE template_id=new.template_id;
 END;`)
	return err
}
func migrateRegistryV6ToV7(tx *sql.Tx) error {
	if err := verifyRegistryVersion(tx, 6); err != nil {
		return err
	}
	if err := applyTemplateVersionsSchema(tx); err != nil {
		return err
	}
	rows, err := tx.Query(`SELECT ` + templateSourceColumns + ` FROM managed_web_service_template_sources`)
	if err != nil {
		return err
	}
	var sources []ManagedTemplateSource
	for rows.Next() {
		var s ManagedTemplateSource
		if err := scanTemplateSource(rows, &s); err != nil {
			rows.Close()
			return err
		}
		sources = append(sources, s)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, s := range sources {
		if err := retainSourceVersion(tx, s); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO managed_web_service_source_bindings SELECT service_id,template_id,?,0 FROM managed_web_services WHERE template_id=?`, s.SHA256, s.TemplateID); err != nil {
			return err
		}
	}
	return verifyRegistryVersion(tx, 7)
}
func retainSourceVersion(tx *sql.Tx, s ManagedTemplateSource) error {
	// Source metadata references originals; no executable document is duplicated.
	raw, err := json.Marshal(s)
	if err != nil {
		return err
	}
	_, err = tx.Exec(`INSERT INTO managed_web_service_source_versions(template_id,sha256,source_json,directory) VALUES(?,?,?,?) ON CONFLICT(template_id,sha256) DO NOTHING`, s.TemplateID, s.SHA256, string(raw), s.Directory)
	return err
}
func (r *Registry) GetServiceTemplateSource(ctx context.Context, id string) (*ManagedTemplateSource, bool, error) {
	var raw, directory string
	var verified int
	err := r.db.QueryRowContext(nonNilContext(ctx), `SELECT v.source_json,v.directory,b.verified FROM managed_web_service_source_bindings b JOIN managed_web_service_source_versions v ON v.template_id=b.template_id AND v.sha256=b.sha256 WHERE b.service_id=?`, id).Scan(&raw, &directory, &verified)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	var s ManagedTemplateSource
	if err := json.Unmarshal([]byte(raw), &s); err != nil {
		return nil, false, err
	}
	s.Directory = directory
	return &s, verified == 1, nil
}
func (r *Registry) VerifyServiceTemplateSource(ctx context.Context, id, digest string) error {
	_, err := r.db.ExecContext(nonNilContext(ctx), `UPDATE managed_web_service_source_bindings SET verified=1 WHERE service_id=? AND sha256=?`, id, digest)
	return err
}
func (r *Registry) ListRetainedTemplateDirectories(ctx context.Context) ([]string, error) {
	rows, err := r.db.QueryContext(nonNilContext(ctx), `SELECT directory FROM managed_web_service_source_versions`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var dirs []string
	for rows.Next() {
		var dir string
		if err := rows.Scan(&dir); err != nil {
			return nil, err
		}
		dirs = append(dirs, dir)
	}
	return dirs, rows.Err()
}
func (r *Registry) CollectUnreferencedTemplateVersions(ctx context.Context) error {
	_, err := r.db.ExecContext(nonNilContext(ctx), `DELETE FROM managed_web_service_source_versions WHERE NOT EXISTS(SELECT 1 FROM managed_web_service_template_sources s WHERE s.template_id=managed_web_service_source_versions.template_id AND s.sha256=managed_web_service_source_versions.sha256) AND NOT EXISTS(SELECT 1 FROM managed_web_service_source_bindings b WHERE b.template_id=managed_web_service_source_versions.template_id AND b.sha256=managed_web_service_source_versions.sha256) AND NOT EXISTS(SELECT 1 FROM managed_web_services s JOIN managed_web_service_operations o ON o.service_id=s.service_id WHERE s.template_id=managed_web_service_source_versions.template_id AND (o.state IN ('pending','running','cancelling') OR s.runtime_manifest_json LIKE '%redeven.managed_service_reconfigure.v1%'))`)
	return err
}

func (r *Registry) GetTemplateSourceVersion(ctx context.Context, id, digest string) (*ManagedTemplateSource, error) {
	var raw, directory string
	err := r.db.QueryRowContext(nonNilContext(ctx), `SELECT source_json,directory FROM managed_web_service_source_versions WHERE template_id=? AND sha256=?`, id, digest).Scan(&raw, &directory)
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
