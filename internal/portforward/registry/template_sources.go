package registry

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

var ErrManagedTemplateSourceChanged = errors.New("template source changed after review")
var ErrManagedTemplateSourceBusy = errors.New("a service operation is using this template source")

// ManagedTemplateSource indexes an original directory. It deliberately stores
// no executable definition; the published reader resolves that directory.
type ManagedTemplateSource struct {
	TemplateID         string `json:"template_id"`
	Repository         string `json:"repository"`
	RepositoryID       int64  `json:"repository_id"`
	Ref                string `json:"ref"`
	Path               string `json:"path"`
	CommitSHA          string `json:"commit_sha"`
	SHA256             string `json:"sha256"`
	Directory          string `json:"-"`
	DocumentTemplateID string `json:"document_template_id"`
	DocumentFamilyID   string `json:"document_family_id"`
	Deployment         string `json:"deployment"`
	Revision           int64  `json:"revision"`
	Name               string `json:"name"`
	Description        string `json:"description"`
	DefaultLocale      string `json:"default_locale"`
	CreatedAtUnixMs    int64  `json:"created_at_unix_ms"`
	UpdatedAtUnixMs    int64  `json:"updated_at_unix_ms"`
}

const templateSourceColumns = "template_id,repository,repository_id,ref,path,commit_sha,sha256,directory,document_template_id,document_family_id,deployment,revision,name,description,default_locale,created_at_unix_ms,updated_at_unix_ms"

func applyTemplateSourcesSchema(tx *sql.Tx) error {
	_, err := tx.Exec(`CREATE TABLE managed_web_service_template_sources (
 template_id TEXT PRIMARY KEY,
 repository TEXT NOT NULL,
 repository_id INTEGER NOT NULL CHECK(repository_id > 0),
 ref TEXT NOT NULL,
 path TEXT NOT NULL,
 commit_sha TEXT NOT NULL CHECK(length(commit_sha)=40 AND commit_sha NOT GLOB '*[^0-9a-f]*'),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
 directory TEXT NOT NULL UNIQUE CHECK(length(directory) BETWEEN 1 AND 128 AND directory NOT GLOB '*[^a-zA-Z0-9_-]*'),
 document_template_id TEXT NOT NULL,
 document_family_id TEXT NOT NULL,
 deployment TEXT NOT NULL CHECK(deployment IN ('host','container','compose')),
 revision INTEGER NOT NULL CHECK(revision>0),
 name TEXT NOT NULL,
 description TEXT NOT NULL,
 default_locale TEXT NOT NULL,
 created_at_unix_ms INTEGER NOT NULL,
 updated_at_unix_ms INTEGER NOT NULL,
 UNIQUE(repository_id,document_template_id)
 )`)
	return err
}

func migrateRegistryV4ToV5(tx *sql.Tx) error {
	if err := verifyRegistryVersion(tx, 4); err != nil {
		return err
	}
	if err := applyTemplateSourcesSchema(tx); err != nil {
		return err
	}
	return verifyRegistryVersion(tx, 5)
}

func scanTemplateSource(row interface{ Scan(...any) error }, v *ManagedTemplateSource) error {
	return row.Scan(&v.TemplateID, &v.Repository, &v.RepositoryID, &v.Ref, &v.Path, &v.CommitSHA, &v.SHA256, &v.Directory, &v.DocumentTemplateID, &v.DocumentFamilyID, &v.Deployment, &v.Revision, &v.Name, &v.Description, &v.DefaultLocale, &v.CreatedAtUnixMs, &v.UpdatedAtUnixMs)
}
func (r *Registry) GetManagedTemplateSource(ctx context.Context, id string) (*ManagedTemplateSource, error) {
	var v ManagedTemplateSource
	err := scanTemplateSource(r.db.QueryRowContext(nonNilContext(ctx), `SELECT `+templateSourceColumns+` FROM managed_web_service_template_sources WHERE template_id=?`, id), &v)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &v, err
}
func (r *Registry) ListManagedTemplateSources(ctx context.Context) ([]ManagedTemplateSource, error) {
	rows, err := r.db.QueryContext(nonNilContext(ctx), `SELECT `+templateSourceColumns+` FROM managed_web_service_template_sources ORDER BY template_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []ManagedTemplateSource{}
	for rows.Next() {
		var v ManagedTemplateSource
		if err := scanTemplateSource(rows, &v); err != nil {
			return nil, err
		}
		result = append(result, v)
	}
	return result, rows.Err()
}

// CommitManagedTemplateSource atomically compares the reviewed source, checks
// active operations, switches the directory pointer, and records idempotency.
func (r *Registry) CommitManagedTemplateSource(ctx context.Context, v ManagedTemplateSource, expected string, req ManagedTemplateRequest) error {
	tx, err := r.db.BeginTx(nonNilContext(ctx), nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var fingerprint, id string
	err = tx.QueryRow(`SELECT request_fingerprint,template_id FROM managed_web_service_template_requests WHERE request_id=?`, req.RequestID).Scan(&fingerprint, &id)
	if err == nil {
		if fingerprint != req.RequestFingerprint || id != v.TemplateID {
			return ErrManagedTemplateSourceChanged
		}
		return nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	var old ManagedTemplateSource
	err = scanTemplateSource(tx.QueryRow(`SELECT `+templateSourceColumns+` FROM managed_web_service_template_sources WHERE template_id=?`, v.TemplateID), &old)
	exists := err == nil
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if (exists && old.SHA256 != expected) || (!exists && expected != "") {
		return ErrManagedTemplateSourceChanged
	}
	if exists && (old.RepositoryID != v.RepositoryID || old.DocumentTemplateID != v.DocumentTemplateID || old.DocumentFamilyID != v.DocumentFamilyID || old.Deployment != v.Deployment) {
		return ErrManagedTemplateSourceChanged
	}
	var active int
	if err := tx.QueryRow(`SELECT COUNT(1) FROM managed_web_service_operations o JOIN managed_web_services s ON s.service_id=o.service_id WHERE s.template_id=? AND o.state IN ('pending','running','cancelling')`, v.TemplateID).Scan(&active); err != nil {
		return err
	}
	if active != 0 {
		return ErrManagedTemplateSourceBusy
	}
	now := time.Now().UnixMilli()
	v.CreatedAtUnixMs = now
	if exists {
		v.CreatedAtUnixMs = old.CreatedAtUnixMs
	}
	v.UpdatedAtUnixMs = now
	_, err = tx.Exec(`INSERT INTO managed_web_service_template_sources (`+templateSourceColumns+`) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(template_id) DO UPDATE SET repository=excluded.repository,ref=excluded.ref,path=excluded.path,commit_sha=excluded.commit_sha,sha256=excluded.sha256,directory=excluded.directory,revision=excluded.revision,name=excluded.name,description=excluded.description,default_locale=excluded.default_locale,updated_at_unix_ms=excluded.updated_at_unix_ms`, v.TemplateID, v.Repository, v.RepositoryID, v.Ref, v.Path, v.CommitSHA, v.SHA256, v.Directory, v.DocumentTemplateID, v.DocumentFamilyID, v.Deployment, v.Revision, v.Name, v.Description, v.DefaultLocale, v.CreatedAtUnixMs, v.UpdatedAtUnixMs)
	if err != nil {
		return err
	}
	_, err = tx.Exec(`INSERT INTO managed_web_service_template_requests(request_id,request_fingerprint,template_id,action,created_at_unix_ms) VALUES(?,?,?,?,?)`, req.RequestID, req.RequestFingerprint, v.TemplateID, "source-confirm", now)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (r *Registry) DeleteManagedTemplateSource(ctx context.Context, id string) error {
	tx, err := r.db.BeginTx(nonNilContext(ctx), nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var count int
	if err := tx.QueryRow(`SELECT COUNT(1) FROM managed_web_services WHERE template_id=?`, id).Scan(&count); err != nil {
		return err
	}
	if count != 0 {
		return ErrManagedTemplateInUse
	}
	if _, err := tx.Exec(`DELETE FROM managed_web_service_template_sources WHERE template_id=?`, id); err != nil {
		return err
	}
	return tx.Commit()
}
