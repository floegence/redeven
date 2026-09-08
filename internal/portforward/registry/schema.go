package registry

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path"
	"slices"
	"strings"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

const (
	registrySchemaKind           = "portforward_registry_v2"
	registryCurrentSchemaVersion = 2
)

func registrySchemaSpec() sqliteutil.Spec {
	return sqliteutil.Spec{
		Kind:             registrySchemaKind,
		CurrentVersion:   registryCurrentSchemaVersion,
		Pragmas:          []string{`PRAGMA journal_mode=WAL;`, `PRAGMA busy_timeout=3000;`, `PRAGMA foreign_keys=ON;`},
		ValidateExisting: validateExistingRegistry,
		Migrations: []sqliteutil.Migration{
			{FromVersion: 0, ToVersion: 1, Apply: initializeRegistryV1},
			{FromVersion: 1, ToVersion: 2, Apply: migrateRegistryV1ToV2},
		},
		Verify: verifyRegistryV2,
	}
}

func validateExistingRegistry(tx *sql.Tx) error {
	var kind string
	if err := tx.QueryRow(`SELECT db_kind FROM __redeven_db_meta WHERE singleton=1`).Scan(&kind); err != nil {
		tables, _ := sqliteutil.ListUserTablesTx(tx)
		return &sqliteutil.WrongDatabaseKindError{ExpectedKind: registrySchemaKind, Existing: tables}
	}
	if kind != registrySchemaKind {
		tables, _ := sqliteutil.ListUserTablesTx(tx)
		return &sqliteutil.WrongDatabaseKindError{ExpectedKind: registrySchemaKind, ActualKind: kind, Existing: tables}
	}
	var version int
	if err := tx.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		return err
	}
	if version > registryCurrentSchemaVersion {
		return &sqliteutil.DatabaseTooNewError{Kind: kind, Version: version, CurrentVersion: registryCurrentSchemaVersion}
	}
	if version < 1 {
		return &sqliteutil.DatabaseTooOldError{Kind: kind, Version: version, MinimumVersion: 1}
	}
	if err := verifyRegistryVersion(tx, version); err != nil {
		return &sqliteutil.SchemaVerifyError{Kind: kind, Err: err}
	}
	return nil
}

func initializeRegistryV1(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE port_forwards (
  forward_id TEXT PRIMARY KEY
    CHECK(length(forward_id) BETWEEN 1 AND 48
      AND forward_id NOT GLOB '*[^a-z0-9-]*'
      AND substr(forward_id, 1, 1) != '-'
      AND substr(forward_id, -1, 1) != '-'),
  target_url TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  health_path TEXT NOT NULL DEFAULT '',
  insecure_skip_verify INTEGER NOT NULL DEFAULT 0,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  last_opened_at_unix_ms INTEGER NOT NULL,
  access_mode TEXT NOT NULL DEFAULT 'unified_proxy'
    CHECK(access_mode IN ('unified_proxy','desktop_loopback'))
);

CREATE TABLE managed_web_service_templates (
  template_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  deployment TEXT NOT NULL CHECK(deployment IN ('host','container','compose')),
  revision INTEGER NOT NULL CHECK(revision > 0),
  spec_json TEXT NOT NULL,
  spec_sha256 TEXT NOT NULL,
  derived_from_template_id TEXT NOT NULL DEFAULT '',
  derived_from_revision INTEGER NOT NULL DEFAULT 0,
  service_family_id TEXT NOT NULL UNIQUE,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL
);

CREATE TABLE managed_web_service_template_requests (
  request_id TEXT PRIMARY KEY,
  request_fingerprint TEXT NOT NULL,
  template_id TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL
);

CREATE TABLE managed_web_services (
  service_id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL UNIQUE,
  workspace_path TEXT NOT NULL,
  workspace_ownership TEXT NOT NULL
    CHECK(workspace_ownership IN ('pending','redeven_created','user_selected')),
  configuration_json TEXT NOT NULL,
  configuration_revision INTEGER NOT NULL CHECK(configuration_revision > 0),
  configuration_sha256 TEXT NOT NULL,
  release_identity_json TEXT NOT NULL,
  release_identity_sha256 TEXT NOT NULL,
  runtime_binding_json TEXT NOT NULL,
  runtime_binding_sha256 TEXT NOT NULL,
  desired_state TEXT NOT NULL,
  observed_state TEXT NOT NULL,
  forward_id TEXT NOT NULL UNIQUE REFERENCES port_forwards(forward_id) ON DELETE RESTRICT,
  runtime_identity TEXT NOT NULL DEFAULT '',
  runtime_spec_sha256 TEXT NOT NULL DEFAULT '',
  runtime_manifest_json TEXT NOT NULL DEFAULT '{}',
  runtime_port INTEGER NOT NULL DEFAULT 0,
  artifact_reference TEXT NOT NULL DEFAULT '',
  last_error_code TEXT NOT NULL DEFAULT '',
  last_error_message TEXT NOT NULL DEFAULT '',
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL
);

CREATE TABLE managed_web_service_resources (
  service_id TEXT NOT NULL REFERENCES managed_web_services(service_id) ON DELETE CASCADE,
  resource_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  engine_identity TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL,
  PRIMARY KEY(service_id, resource_id)
);

CREATE TABLE managed_web_service_operations (
  operation_id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  retry_of_operation_id TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  delete_data INTEGER NOT NULL DEFAULT 0,
  delete_workspace INTEGER NOT NULL DEFAULT 0 CHECK(delete_workspace IN (0,1)),
  state TEXT NOT NULL,
  stage TEXT NOT NULL,
  progress_current INTEGER NOT NULL DEFAULT 0,
  progress_total INTEGER NOT NULL DEFAULT 0,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  finished_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  progress_detail_json TEXT NOT NULL DEFAULT '{"schema_version":2}'
);

CREATE TABLE managed_web_service_release_checks (
  service_id TEXT PRIMARY KEY REFERENCES managed_web_services(service_id) ON DELETE CASCADE,
  summary_json TEXT NOT NULL,
  summary_sha256 TEXT NOT NULL,
  checked_at_unix_ms INTEGER NOT NULL,
  next_check_at_unix_ms INTEGER NOT NULL,
  stale INTEGER NOT NULL DEFAULT 0 CHECK(stale IN (0,1)),
  last_error_code TEXT NOT NULL DEFAULT '',
  updated_at_unix_ms INTEGER NOT NULL
);
`)
	return err
}

func verifyRegistryV1(tx *sql.Tx) error {
	return verifyRegistryVersion(tx, 1)
}

func verifyRegistryV2(tx *sql.Tx) error {
	return verifyRegistryVersion(tx, 2)
}

const addDefaultAppPath = `ALTER TABLE port_forwards ADD COLUMN default_app_path TEXT NOT NULL DEFAULT '/'`

func migrateRegistryV1ToV2(tx *sql.Tx) error {
	if err := verifyRegistryV1(tx); err != nil {
		return err
	}
	if _, err := tx.Exec(addDefaultAppPath); err != nil {
		return err
	}
	return verifyRegistryV2(tx)
}

// Compare all user DDL with the reviewed initializer and contiguous migrations,
// including column types, defaults, constraints, indexes, and triggers.
func verifyRegistryShape(tx *sql.Tx, version int) error {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		return err
	}
	defer db.Close()
	expected, err := db.Begin()
	if err != nil {
		return err
	}
	defer expected.Rollback()
	if err := initializeRegistryV1(expected); err != nil {
		return err
	}
	if version == 2 {
		if _, err := expected.Exec(addDefaultAppPath); err != nil {
			return err
		}
	}
	read := func(source *sql.Tx) ([]string, error) {
		rows, err := source.Query(`SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name <> '__redeven_db_meta' ORDER BY type, name`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var result []string
		for rows.Next() {
			var kind, name, ddl string
			if err := rows.Scan(&kind, &name, &ddl); err != nil {
				return nil, err
			}
			result = append(result, kind+":"+name+":"+strings.Join(strings.Fields(ddl), " "))
		}
		return result, rows.Err()
	}
	want, err := read(expected)
	if err != nil {
		return err
	}
	got, err := read(tx)
	if err != nil {
		return err
	}
	if !slices.Equal(got, want) {
		return fmt.Errorf("port forward registry version %d schema drift", version)
	}
	return nil
}

func verifyRegistryVersion(tx *sql.Tx, version int) error {
	if err := verifyRegistryShape(tx, version); err != nil {
		return err
	}
	tables, err := sqliteutil.ListUserTablesTx(tx)
	if err != nil {
		return err
	}
	wantTables := []string{
		"managed_web_service_operations", "managed_web_service_release_checks", "managed_web_service_resources",
		"managed_web_service_template_requests", "managed_web_service_templates", "managed_web_services", "port_forwards",
	}
	if !slices.Equal(tables, wantTables) {
		return fmt.Errorf("port forward registry v2 table mismatch: got %v, want %v", tables, wantTables)
	}
	wantColumns := map[string][]string{
		"port_forwards":                         {"forward_id", "target_url", "name", "description", "health_path", "insecure_skip_verify", "created_at_unix_ms", "updated_at_unix_ms", "last_opened_at_unix_ms", "access_mode"},
		"managed_web_service_templates":         {"template_id", "name", "description", "source", "deployment", "revision", "spec_json", "spec_sha256", "derived_from_template_id", "derived_from_revision", "service_family_id", "created_at_unix_ms", "updated_at_unix_ms"},
		"managed_web_service_template_requests": {"request_id", "request_fingerprint", "template_id", "action", "created_at_unix_ms"},
		"managed_web_services":                  {"service_id", "template_id", "workspace_path", "workspace_ownership", "configuration_json", "configuration_revision", "configuration_sha256", "release_identity_json", "release_identity_sha256", "runtime_binding_json", "runtime_binding_sha256", "desired_state", "observed_state", "forward_id", "runtime_identity", "runtime_spec_sha256", "runtime_manifest_json", "runtime_port", "artifact_reference", "last_error_code", "last_error_message", "created_at_unix_ms", "updated_at_unix_ms"},
		"managed_web_service_resources":         {"service_id", "resource_id", "kind", "engine_identity", "created_at_unix_ms"},
		"managed_web_service_operations":        {"operation_id", "service_id", "request_id", "request_fingerprint", "retry_of_operation_id", "action", "delete_data", "delete_workspace", "state", "stage", "progress_current", "progress_total", "cancel_requested", "error_code", "error_message", "created_at_unix_ms", "updated_at_unix_ms", "finished_at_unix_ms", "progress_detail_json"},
		"managed_web_service_release_checks":    {"service_id", "summary_json", "summary_sha256", "checked_at_unix_ms", "next_check_at_unix_ms", "stale", "last_error_code", "updated_at_unix_ms"},
	}
	if version == 2 {
		wantColumns["port_forwards"] = append(wantColumns["port_forwards"], "default_app_path")
	}
	for table, want := range wantColumns {
		got, err := sqliteutil.TableColumnNamesTx(tx, table)
		if err != nil {
			return err
		}
		if !slices.Equal(got, want) {
			return fmt.Errorf("port forward registry v2 %s column mismatch: got %v, want %v", table, got, want)
		}
	}
	indexes, err := sqliteutil.ListUserIndexesTx(tx)
	if err != nil {
		return err
	}
	if len(indexes) != 0 {
		return fmt.Errorf("port forward registry v2 has unexpected indexes %v", indexes)
	}
	if err := verifyRegistryDocuments(tx); err != nil {
		return err
	}
	if err := verifyTemplateSpecDocuments(tx); err != nil {
		return err
	}
	if err := verifyReleaseCheckSchemaV2(tx); err != nil {
		return err
	}
	checks := []struct{ query, message string }{
		{`SELECT COUNT(1) FROM port_forwards WHERE access_mode NOT IN ('unified_proxy','desktop_loopback')`, "invalid access modes"},
		{`SELECT COUNT(1) FROM port_forwards WHERE length(forward_id) NOT BETWEEN 1 AND 48 OR forward_id GLOB '*[^a-z0-9-]*' OR substr(forward_id,1,1)='-' OR substr(forward_id,-1,1)='-'`, "invalid forward identities"},
		{`SELECT COUNT(1) FROM managed_web_services WHERE workspace_ownership NOT IN ('pending','redeven_created','user_selected')`, "invalid workspace ownership values"},
		{`SELECT COUNT(1) FROM managed_web_service_operations WHERE delete_workspace NOT IN (0,1)`, "invalid workspace deletion values"},
		{`SELECT COUNT(1) FROM managed_web_services WHERE runtime_spec_sha256 <> '' AND (length(runtime_spec_sha256) <> 64 OR runtime_spec_sha256 GLOB '*[^0-9a-f]*')`, "invalid runtime specification digests"},
	}
	for _, check := range checks {
		var invalid int
		if err := tx.QueryRow(check.query).Scan(&invalid); err != nil {
			return err
		}
		if invalid != 0 {
			return fmt.Errorf("port forward registry v2 has %d %s", invalid, check.message)
		}
	}
	return nil
}

type registryReleaseIdentityV1 struct {
	SchemaVersion     int    `json:"schema_version"`
	Kind              string `json:"kind"`
	Source            string `json:"source,omitempty"`
	Registry          string `json:"registry,omitempty"`
	Version           string `json:"version,omitempty"`
	Tag               string `json:"tag,omitempty"`
	Digest            string `json:"digest,omitempty"`
	Integrity         string `json:"integrity,omitempty"`
	Platform          string `json:"platform,omitempty"`
	ArtifactReference string `json:"artifact_reference,omitempty"`
	Trust             string `json:"trust,omitempty"`
}

type registryReleaseCandidateV2 struct {
	SchemaVersion        int    `json:"schema_version"`
	CandidateID          string `json:"candidate_id"`
	SourceKind           string `json:"source_kind"`
	Source               string `json:"source"`
	Registry             string `json:"registry,omitempty"`
	Version              string `json:"version,omitempty"`
	Tag                  string `json:"tag,omitempty"`
	PublishedAtUnixMs    int64  `json:"published_at_unix_ms,omitempty"`
	Channel              string `json:"channel"`
	Deprecated           bool   `json:"deprecated,omitempty"`
	DeprecationMessage   string `json:"deprecation_message,omitempty"`
	Trust                string `json:"trust"`
	Selectable           bool   `json:"selectable"`
	ReasonCode           string `json:"reason_code,omitempty"`
	Reason               string `json:"reason,omitempty"`
	Platform             string `json:"platform,omitempty"`
	IndexDigest          string `json:"index_digest,omitempty"`
	Digest               string `json:"digest,omitempty"`
	Integrity            string `json:"integrity,omitempty"`
	TagMoved             bool   `json:"tag_moved,omitempty"`
	IsCurrent            bool   `json:"is_current,omitempty"`
	IsRecommended        bool   `json:"is_recommended,omitempty"`
	RecommendationStatus string `json:"recommendation_status,omitempty"`
	DigestVerified       bool   `json:"digest_verified,omitempty"`
	IsLatestStable       bool   `json:"is_latest_stable,omitempty"`
	IsLatestPreview      bool   `json:"is_latest_preview,omitempty"`
	Relation             string `json:"relation"`
	VerificationStatus   string `json:"verification_status"`
}

type registryReleaseCheckV2 struct {
	SchemaVersion        int                          `json:"schema_version"`
	SourceFingerprint    string                       `json:"source_fingerprint,omitempty"`
	CatalogStatus        string                       `json:"catalog_status"`
	Candidates           []registryReleaseCandidateV2 `json:"candidates"`
	LatestStableRelease  *registryReleaseIdentityV1   `json:"latest_stable_release,omitempty"`
	LatestPreviewRelease *registryReleaseIdentityV1   `json:"latest_preview_release,omitempty"`
}

type registryRuntimeBindingV2 struct {
	SchemaVersion   int                                `json:"schema_version"`
	ServiceFamilyID string                             `json:"service_family_id"`
	Deployment      string                             `json:"deployment"`
	Host            *registryHostRuntimeBindingV2      `json:"host,omitempty"`
	Container       *registryContainerRuntimeBindingV2 `json:"container,omitempty"`
	Compose         *registryComposeRuntimeBindingV2   `json:"compose,omitempty"`
}

type registryHostRuntimeBindingV2 struct {
	InstallRoot string `json:"install_root"`
	DataRoot    string `json:"data_root"`
	LogPath     string `json:"log_path"`
}

type registryContainerRuntimeBindingV2 struct {
	Name string `json:"name"`
}

type registryComposeRuntimeBindingV2 struct {
	ProjectName string `json:"project_name"`
	ConfigRoot  string `json:"config_root"`
}

func verifyReleaseCheckSchemaV2(tx *sql.Tx) error {
	rows, err := tx.Query(`SELECT service_id,summary_json FROM managed_web_service_release_checks ORDER BY service_id`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var serviceID, raw string
		if err := rows.Scan(&serviceID, &raw); err != nil {
			return err
		}
		var document registryReleaseCheckV2
		if err := decodeStrictRegistryJSON(raw, &document); err != nil || document.SchemaVersion != 2 || document.Candidates == nil {
			return fmt.Errorf("release check %s schema v2 is invalid", serviceID)
		}
		if document.CatalogStatus != "loading" && document.CatalogStatus != "complete" && document.CatalogStatus != "stale" && document.CatalogStatus != "error" {
			return fmt.Errorf("release check %s catalog status is invalid", serviceID)
		}
		for _, candidate := range document.Candidates {
			if candidate.SchemaVersion != 2 || candidate.CandidateID != "" || candidate.Source == "" ||
				(candidate.SourceKind != "npm" && candidate.SourceKind != "oci") ||
				(candidate.Channel != "stable" && candidate.Channel != "preview" && candidate.Channel != "special") ||
				(candidate.Relation != "newer" && candidate.Relation != "same" && candidate.Relation != "older" && candidate.Relation != "unknown") ||
				(candidate.VerificationStatus != "pending" && candidate.VerificationStatus != "verified" && candidate.VerificationStatus != "unavailable") ||
				(candidate.RecommendationStatus != "" && candidate.RecommendationStatus != "pending" && candidate.RecommendationStatus != "available" && candidate.RecommendationStatus != "unavailable") {
				return fmt.Errorf("release check %s candidate schema v2 is invalid", serviceID)
			}
		}
		for _, identity := range []*registryReleaseIdentityV1{document.LatestStableRelease, document.LatestPreviewRelease} {
			if identity != nil && (identity.SchemaVersion != 1 || (identity.Kind != "npm" && identity.Kind != "oci")) {
				return fmt.Errorf("release check %s latest release identity is invalid", serviceID)
			}
		}
	}
	return rows.Err()
}

func verifyTemplateSpecDocuments(tx *sql.Tx) error {
	rows, err := tx.Query(`SELECT template_id,spec_json FROM managed_web_service_templates ORDER BY template_id`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id, raw string
		if err := rows.Scan(&id, &raw); err != nil {
			return err
		}
		var value struct {
			SchemaVersion int `json:"schema_version"`
			Container     *struct {
				ReleasePolicy json.RawMessage `json:"release_policy"`
			} `json:"container,omitempty"`
		}
		if err := json.Unmarshal([]byte(raw), &value); err != nil || value.SchemaVersion != 5 {
			return fmt.Errorf("TemplateSpec %s schema version is invalid", id)
		}
		if value.Container != nil && len(value.Container.ReleasePolicy) != 0 {
			return fmt.Errorf("TemplateSpec %s contains retired release policy", id)
		}
	}
	return rows.Err()
}

func verifyRegistryDocuments(tx *sql.Tx) error {
	templateRows, err := tx.Query(`SELECT template_id,spec_json,spec_sha256 FROM managed_web_service_templates ORDER BY template_id`)
	if err != nil {
		return err
	}
	for templateRows.Next() {
		var owner, raw, digest string
		if err := templateRows.Scan(&owner, &raw, &digest); err != nil {
			_ = templateRows.Close()
			return err
		}
		if err := verifyDocumentDigest("template spec", owner, raw, digest); err != nil {
			_ = templateRows.Close()
			return err
		}
	}
	if err := templateRows.Close(); err != nil {
		return err
	}
	if err := templateRows.Err(); err != nil {
		return err
	}

	serviceRows, err := tx.Query(`SELECT service_id,configuration_json,configuration_sha256,release_identity_json,release_identity_sha256,runtime_binding_json,runtime_binding_sha256 FROM managed_web_services ORDER BY service_id`)
	if err != nil {
		return err
	}
	defer serviceRows.Close()
	for serviceRows.Next() {
		var owner string
		var documents [3][2]string
		if err := serviceRows.Scan(&owner, &documents[0][0], &documents[0][1], &documents[1][0], &documents[1][1], &documents[2][0], &documents[2][1]); err != nil {
			return err
		}
		labels := []string{"configuration", "release identity", "runtime binding"}
		for index := range documents {
			if err := verifyDocumentDigest(labels[index], owner, documents[index][0], documents[index][1]); err != nil {
				return err
			}
		}
		if err := verifyRuntimeBindingV2(owner, documents[2][0]); err != nil {
			return err
		}
	}
	if err := serviceRows.Err(); err != nil {
		return err
	}

	operationRows, err := tx.Query(`SELECT operation_id,progress_detail_json FROM managed_web_service_operations ORDER BY operation_id`)
	if err != nil {
		return err
	}
	defer operationRows.Close()
	for operationRows.Next() {
		var operationID, raw string
		if err := operationRows.Scan(&operationID, &raw); err != nil {
			return err
		}
		if _, _, err := decodeManagedOperationProgressDetailVersion(raw, 2); err != nil {
			return fmt.Errorf("operation %s progress detail: %w", operationID, err)
		}
	}
	if err := operationRows.Err(); err != nil {
		return err
	}
	releaseRows, err := tx.Query(`SELECT service_id,summary_json,summary_sha256 FROM managed_web_service_release_checks ORDER BY service_id`)
	if err != nil {
		return err
	}
	defer releaseRows.Close()
	for releaseRows.Next() {
		var serviceID, raw, digest string
		if err := releaseRows.Scan(&serviceID, &raw, &digest); err != nil {
			return err
		}
		if err := verifyDocumentDigest("release check", serviceID, raw, digest); err != nil {
			return err
		}
	}
	return releaseRows.Err()
}

func verifyRuntimeBindingV2(serviceID, raw string) error {
	binding := registryRuntimeBindingV2{}
	if err := decodeStrictRegistryJSON(raw, &binding); err != nil {
		return fmt.Errorf("runtime binding %s: %w", serviceID, err)
	}
	if binding.SchemaVersion != 2 || binding.ServiceFamilyID == "" || binding.ServiceFamilyID != strings.TrimSpace(binding.ServiceFamilyID) {
		return fmt.Errorf("runtime binding %s ownership is invalid", serviceID)
	}
	switch binding.Deployment {
	case "host":
		instanceRoot := path.Join("instances", serviceID)
		if binding.Host == nil || binding.Container != nil || binding.Compose != nil ||
			binding.Host.InstallRoot != path.Join(instanceRoot, "install") ||
			binding.Host.DataRoot != path.Join("families", binding.ServiceFamilyID, "data") ||
			binding.Host.LogPath != path.Join(instanceRoot, "logs", "service.log") {
			return fmt.Errorf("runtime binding %s host identity is invalid", serviceID)
		}
	case "container":
		if binding.Host != nil || binding.Container == nil || binding.Compose != nil ||
			binding.Container.Name != registryContainerName(serviceID) {
			return fmt.Errorf("runtime binding %s container identity is invalid", serviceID)
		}
	case "compose":
		if binding.Host != nil || binding.Container != nil || binding.Compose == nil ||
			binding.Compose.ProjectName != "redeven_"+registryResourceNameSuffix(serviceID) ||
			binding.Compose.ConfigRoot != path.Join("instances", serviceID, "compose") {
			return fmt.Errorf("runtime binding %s compose identity is invalid", serviceID)
		}
	default:
		return fmt.Errorf("runtime binding %s deployment is invalid", serviceID)
	}
	return nil
}

func registryContainerName(serviceID string) string {
	return "redeven-mws-" + strings.TrimPrefix(strings.TrimSpace(serviceID), "mws_")
}

func registryResourceNameSuffix(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var builder strings.Builder
	for _, char := range value {
		if char >= 'a' && char <= 'z' || char >= '0' && char <= '9' || char == '-' || char == '_' {
			builder.WriteRune(char)
		} else {
			builder.WriteByte('-')
		}
	}
	result := strings.Trim(builder.String(), "-_")
	if result == "" {
		return "service"
	}
	if len(result) > 48 {
		return result[:48]
	}
	return result
}

func verifyDocumentDigest(kind, owner, raw, expected string) error {
	sum := sha256.Sum256([]byte(raw))
	if actual := hex.EncodeToString(sum[:]); actual != strings.TrimSpace(expected) {
		return fmt.Errorf("managed Web Service %s %s SHA-256 mismatch", kind, owner)
	}
	return nil
}

func decodeStrictRegistryJSON(raw string, target any) error {
	decoder := json.NewDecoder(strings.NewReader(strings.TrimSpace(raw)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values")
		}
		return err
	}
	return nil
}
