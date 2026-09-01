package registry

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"slices"
	"strings"

	"github.com/floegence/redeven/internal/persistence/sqliteutil"
)

const (
	registrySchemaKind           = "portforward_registry"
	registryCurrentSchemaVersion = 8
)

func registrySchemaSpec() sqliteutil.Spec {
	return sqliteutil.Spec{
		Kind:           registrySchemaKind,
		CurrentVersion: registryCurrentSchemaVersion,
		Pragmas:        []string{`PRAGMA journal_mode=WAL;`, `PRAGMA busy_timeout=3000;`, `PRAGMA foreign_keys=ON;`},
		Migrations: []sqliteutil.Migration{
			{FromVersion: 0, ToVersion: 1, Apply: migrateRegistryToV1},
			{FromVersion: 1, ToVersion: 2, Apply: migrateRegistryToV2},
			{FromVersion: 2, ToVersion: 3, Apply: migrateRegistryToV3},
			{FromVersion: 3, ToVersion: 4, Apply: migrateRegistryToV4},
			{FromVersion: 4, ToVersion: 5, Apply: migrateRegistryToV5},
			{FromVersion: 5, ToVersion: 6, Apply: migrateRegistryToV6},
			{FromVersion: 6, ToVersion: 7, Apply: migrateRegistryToV7},
			{FromVersion: 7, ToVersion: 8, Apply: migrateRegistryToV8},
		},
		Verify: verifyRegistrySchema,
	}
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

// registryTemplateSpecDocument is the migration-owned exact decoder. Keeping
// it here lets Registry reject historical/current JSON drift before the
// managed-service Manager starts, without importing the higher-level package.
type registryTemplateSpecDocument struct {
	SchemaVersion int                            `json:"schema_version"`
	Kind          string                         `json:"kind"`
	Endpoint      registryTemplateEndpoint       `json:"endpoint"`
	Parameters    []registryTemplateParameter    `json:"parameters,omitempty"`
	Host          *registryHostTemplateSpec      `json:"host,omitempty"`
	Container     *registryContainerTemplateSpec `json:"container,omitempty"`
	Compose       *registryComposeTemplateSpec   `json:"compose,omitempty"`
}

type registryTemplateEndpoint struct {
	Scheme         string `json:"scheme"`
	ContainerPort  int    `json:"container_port,omitempty"`
	FixedHostPort  int    `json:"fixed_host_port,omitempty"`
	Path           string `json:"path,omitempty"`
	HealthPath     string `json:"health_path,omitempty"`
	HealthProtocol string `json:"health_protocol,omitempty"`
	StartupTimeout int    `json:"startup_timeout_sec,omitempty"`
}

type registryTemplateParameter struct {
	Name        string `json:"name"`
	Label       string `json:"label"`
	Description string `json:"description,omitempty"`
	Type        string `json:"type"`
	Required    bool   `json:"required,omitempty"`
	Default     string `json:"default,omitempty"`
}

type registryHostTemplateSpec struct {
	InstallScript   string                      `json:"install_script,omitempty"`
	StartScript     string                      `json:"start_script"`
	StopScript      string                      `json:"stop_script,omitempty"`
	UninstallScript string                      `json:"uninstall_script,omitempty"`
	Artifact        *registryHostArtifactSpec   `json:"artifact,omitempty"`
	NPM             *registryNPMHostPackageSpec `json:"npm,omitempty"`
	RuntimeBundle   string                      `json:"runtime_bundle,omitempty"`
}

type registryHostArtifactSpec struct {
	DownloadURL       string `json:"download_url"`
	SizeBytes         int64  `json:"size_bytes"`
	SHA256            string `json:"sha256"`
	ExecutableRelPath string `json:"executable_rel_path"`
}

type registryNPMHostPackageSpec struct {
	PackageName        string `json:"package_name"`
	Version            string `json:"version"`
	RegistryURL        string `json:"registry_url"`
	AuthTokenParameter string `json:"auth_token_parameter,omitempty"`
	Executable         string `json:"executable"`
}

type registryContainerTemplateSpec struct {
	Image          string                        `json:"image"`
	Entrypoint     []string                      `json:"entrypoint,omitempty"`
	Command        []string                      `json:"command,omitempty"`
	Environment    map[string]string             `json:"environment,omitempty"`
	Labels         map[string]string             `json:"labels,omitempty"`
	RestartPolicy  string                        `json:"restart_policy,omitempty"`
	NetworkMode    string                        `json:"network_mode,omitempty"`
	PIDMode        string                        `json:"pid_mode,omitempty"`
	IPCMode        string                        `json:"ipc_mode,omitempty"`
	Ports          []registryContainerPortSpec   `json:"ports,omitempty"`
	Mounts         []registryContainerMountSpec  `json:"mounts,omitempty"`
	CapAdd         []string                      `json:"cap_add,omitempty"`
	CapDrop        []string                      `json:"cap_drop,omitempty"`
	Devices        []registryContainerDeviceSpec `json:"devices,omitempty"`
	Privileged     bool                          `json:"privileged,omitempty"`
	SecurityOpts   []string                      `json:"security_opts,omitempty"`
	User           string                        `json:"user,omitempty"`
	ReadOnlyRoot   bool                          `json:"read_only_root"`
	MemoryBytes    int64                         `json:"memory_bytes,omitempty"`
	CPUs           float64                       `json:"cpus,omitempty"`
	PIDsLimit      int64                         `json:"pids_limit,omitempty"`
	ShmSizeBytes   int64                         `json:"shm_size_bytes,omitempty"`
	RuntimeProfile string                        `json:"runtime_profile,omitempty"`
	ReleasePolicy  *registryOCIReleasePolicySpec `json:"release_policy,omitempty"`
}

type registryContainerMountSpec struct {
	ResourceID   string   `json:"resource_id,omitempty"`
	Type         string   `json:"type"`
	Source       string   `json:"source,omitempty"`
	Target       string   `json:"target"`
	ReadOnly     bool     `json:"read_only,omitempty"`
	TmpfsOptions []string `json:"tmpfs_options,omitempty"`
}

type registryContainerPortSpec struct {
	ResourceID    string `json:"resource_id,omitempty"`
	ContainerPort int    `json:"container_port"`
	HostPort      int    `json:"host_port,omitempty"`
	HostIP        string `json:"host_ip,omitempty"`
	Protocol      string `json:"protocol,omitempty"`
}

type registryContainerDeviceSpec struct {
	ResourceID    string `json:"resource_id,omitempty"`
	HostPath      string `json:"host_path"`
	ContainerPath string `json:"container_path,omitempty"`
	Permissions   string `json:"permissions,omitempty"`
}

type registryOCIReleasePolicySpec struct {
	BlockedTagPrefixes []string `json:"blocked_tag_prefixes,omitempty"`
}

type registryComposeTemplateSpec struct {
	YAML        string `json:"yaml"`
	MainService string `json:"main_service"`
}

func decodeRegistryTemplateSpec(raw string, schemaVersion int) (registryTemplateSpecDocument, error) {
	document := registryTemplateSpecDocument{}
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&document); err != nil {
		return document, err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return document, errors.New("template spec contains trailing JSON")
	}
	if document.SchemaVersion != schemaVersion || document.Endpoint.Scheme == "" {
		return document, errors.New("template spec schema or endpoint is invalid")
	}
	switch document.Kind {
	case "host":
		if document.Host == nil || document.Container != nil || document.Compose != nil {
			return document, errors.New("host template spec shape is invalid")
		}
		if (schemaVersion == 1 && document.Host.NPM != nil) || (schemaVersion == 2 && document.Host.RuntimeBundle != "") {
			return document, errors.New("host template package shape does not match its schema")
		}
	case "container":
		if document.Container == nil || document.Host != nil || document.Compose != nil {
			return document, errors.New("container template spec shape is invalid")
		}
		if schemaVersion == 1 && document.Container.ReleasePolicy != nil {
			return document, errors.New("container release policy is not valid in schema v1")
		}
	case "compose":
		if document.Compose == nil || document.Host != nil || document.Container != nil {
			return document, errors.New("Compose template spec shape is invalid")
		}
	default:
		return document, errors.New("template deployment kind is invalid")
	}
	return document, nil
}

func migrateRegistryToV8(tx *sql.Tx) error {
	if err := verifyRegistryShape(tx, []string{"forward_id", "target_url", "name", "description", "health_path", "insecure_skip_verify", "created_at_unix_ms", "updated_at_unix_ms", "last_opened_at_unix_ms", "access_mode"}, "v7"); err != nil {
		return err
	}
	if err := verifyRegistryManagedDocumentDigests(tx); err != nil {
		return err
	}
	if err := verifyRegistryProgressDetailColumn(tx); err != nil {
		return err
	}
	if err := verifyRegistryDeepSeekServiceFamilies(tx); err != nil {
		return err
	}
	templates, err := migrateRegistryTemplateSpecsToV2(tx, `SELECT template_id,version,spec_json FROM managed_web_service_templates ORDER BY template_id`)
	if err != nil {
		return err
	}
	services, err := migrateRegistryServiceSpecsToV2(tx)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(`
ALTER TABLE managed_web_services ADD COLUMN release_identity_json TEXT NOT NULL DEFAULT '{"schema_version":1,"kind":"none"}';
ALTER TABLE managed_web_services ADD COLUMN release_identity_sha256 TEXT NOT NULL DEFAULT '';
`); err != nil {
		return err
	}
	for _, item := range templates {
		if _, err := tx.Exec(`UPDATE managed_web_service_templates SET spec_json=?,spec_sha256=? WHERE template_id=?`, item.encoded, item.digest, item.owner); err != nil {
			return err
		}
	}
	for _, item := range services {
		if _, err := tx.Exec(`UPDATE managed_web_services SET template_snapshot_json=?,template_snapshot_sha256=?,deployment=?,release_identity_json=?,release_identity_sha256=? WHERE service_id=?`, item.spec.encoded, item.spec.digest, item.deployment, item.releaseJSON, item.releaseDigest, item.spec.owner); err != nil {
			return err
		}
	}
	return nil
}

func migrateRegistryTemplateSpecsToV2(tx *sql.Tx, query string) ([]registryMigratedRuntimeSpec, error) {
	rows, err := tx.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []registryMigratedRuntimeSpec
	for rows.Next() {
		var owner, version, raw string
		if err := rows.Scan(&owner, &version, &raw); err != nil {
			return nil, err
		}
		encoded, digest, err := migrateRegistryTemplateSpecV2(owner, version, raw)
		if err != nil {
			return nil, err
		}
		result = append(result, registryMigratedRuntimeSpec{owner: owner, encoded: encoded, digest: digest})
	}
	return result, rows.Err()
}

type registryMigratedServiceV8 struct {
	spec          registryMigratedRuntimeSpec
	deployment    string
	releaseJSON   string
	releaseDigest string
}

func migrateRegistryServiceSpecsToV2(tx *sql.Tx) ([]registryMigratedServiceV8, error) {
	rows, err := tx.Query(`SELECT service_id,template_id,version,deployment,template_snapshot_json,artifact_reference FROM managed_web_services ORDER BY service_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []registryMigratedServiceV8
	for rows.Next() {
		var serviceID, templateID, version, deployment, raw, artifact string
		if err := rows.Scan(&serviceID, &templateID, &version, &deployment, &raw, &artifact); err != nil {
			return nil, err
		}
		encoded, digest, err := migrateRegistryServiceTemplateSpecV2(serviceID, templateID, version, deployment, raw, artifact)
		if err != nil {
			return nil, err
		}
		if templateID == "deepseek-harness-host" && deployment == "native" {
			deployment = "host"
		}
		if templateID == "deepseek-harness-container" && deployment == "docker" {
			deployment = "container"
		}
		migratedSpec := map[string]any{}
		if err := json.Unmarshal([]byte(encoded), &migratedSpec); err != nil {
			return nil, err
		}
		release := registryReleaseIdentityV1{SchemaVersion: 1, Kind: "none", Version: strings.TrimSpace(version)}
		switch deployment {
		case "container":
			exactArtifact := registryExactImageReference(strings.TrimSpace(artifact))
			container, _ := migratedSpec["container"].(map[string]any)
			snapshotImage := registryExactImageReference(strings.TrimSpace(fmt.Sprint(container["image"])))
			if exactArtifact == "" {
				exactArtifact = snapshotImage
			}
			if exactArtifact != "" && snapshotImage != "" && registryImageRepository(exactArtifact) != registryImageRepository(snapshotImage) {
				return nil, fmt.Errorf("managed Web Service %s release identity migration: container artifact and template source disagree", serviceID)
			}
			release.Kind, release.Source, release.ArtifactReference = "oci", registryImageRepository(exactArtifact), exactArtifact
			if before, after, ok := strings.Cut(exactArtifact, "@"); ok {
				release.Digest = after
				release.Tag = registryImageTag(before)
			}
			if release.Source == "" || release.Digest == "" {
				return nil, fmt.Errorf("managed Web Service %s release identity migration: exact container artifact reference is required", serviceID)
			}
		case "host":
			host, _ := migratedSpec["host"].(map[string]any)
			npm, _ := host["npm"].(map[string]any)
			packageName := strings.TrimSpace(fmt.Sprint(npm["package_name"]))
			packageVersion := strings.TrimSpace(fmt.Sprint(npm["version"]))
			if packageName != "" && packageName != "<nil>" && packageVersion != "" && packageVersion != "<nil>" {
				release.Kind, release.Source, release.Registry, release.Version = "npm", packageName, "https://registry.npmjs.org/", packageVersion
				if packageName == "@deepseek-ai/dsh" && packageVersion == "0.1.1-rc.2" {
					release.Integrity = "sha512-UP1UIh6q3Gme/yXRn/QL2P8IsVlv8Shpg22TRJIZPsCRWLm4CBiA1MUvXmJAfsOEETBMLAl+xWPtFw6ICsN3wg=="
				} else {
					return nil, fmt.Errorf("managed Web Service %s release identity migration: npm integrity is ambiguous", serviceID)
				}
				release.ArtifactReference = strings.TrimSpace(artifact)
				release.Trust = "redeven_reviewed_legacy"
			} else if strings.TrimSpace(artifact) != "" {
				release.Kind, release.ArtifactReference = "legacy", strings.TrimSpace(artifact)
			}
		default:
			if strings.TrimSpace(artifact) != "" {
				release.Kind, release.ArtifactReference = "legacy", strings.TrimSpace(artifact)
			}
		}
		releaseRaw, err := json.Marshal(release)
		if err != nil {
			return nil, err
		}
		releaseSum := sha256.Sum256(releaseRaw)
		result = append(result, registryMigratedServiceV8{
			spec: registryMigratedRuntimeSpec{owner: serviceID, encoded: encoded, digest: digest}, deployment: deployment,
			releaseJSON: string(releaseRaw), releaseDigest: hex.EncodeToString(releaseSum[:]),
		})
	}
	return result, rows.Err()
}

func migrateRegistryTemplateSpecV2(owner, version, raw string) (string, string, error) {
	if _, err := decodeRegistryTemplateSpec(raw, 1); err != nil {
		return "", "", fmt.Errorf("managed Web Service %s template spec v2 migration: %w", owner, err)
	}
	document := map[string]any{}
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(&document); err != nil {
		return "", "", fmt.Errorf("managed Web Service %s template spec v2 migration: %w", owner, err)
	}
	schema, ok := document["schema_version"]
	if !ok || fmt.Sprint(schema) != "1" {
		return "", "", fmt.Errorf("managed Web Service %s template spec v2 migration: unsupported schema_version", owner)
	}
	document["schema_version"] = 2
	if host, ok := document["host"].(map[string]any); ok {
		if bundle, present := host["runtime_bundle"].(string); present && strings.TrimSpace(bundle) != "" {
			if !strings.HasPrefix(strings.TrimSpace(bundle), "deepseek-harness-") {
				return "", "", fmt.Errorf("managed Web Service %s template spec v2 migration: unsupported runtime bundle", owner)
			}
			delete(host, "runtime_bundle")
			host["npm"] = map[string]any{
				"package_name": "@deepseek-ai/dsh", "version": strings.TrimSpace(version),
				"registry_url": "https://registry.npmjs.org/", "executable": "dsh",
			}
		}
	}
	encoded, err := json.Marshal(document)
	if err != nil {
		return "", "", err
	}
	if _, err := decodeRegistryTemplateSpec(string(encoded), 2); err != nil {
		return "", "", fmt.Errorf("managed Web Service %s migrated template spec v2: %w", owner, err)
	}
	sum := sha256.Sum256(encoded)
	return string(encoded), hex.EncodeToString(sum[:]), nil
}

func migrateRegistryServiceTemplateSpecV2(owner, templateID, version, deployment, raw, artifact string) (string, string, error) {
	document := map[string]any{}
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(&document); err != nil {
		return "", "", fmt.Errorf("managed Web Service %s template spec v2 migration: %w", owner, err)
	}
	if len(document) == 0 {
		switch templateID {
		case "deepseek-harness-host":
			document = map[string]any{
				"schema_version": 1, "kind": "host",
				"endpoint": map[string]any{"scheme": "http", "path": "/", "health_path": "/", "startup_timeout_sec": 45},
				"host": map[string]any{
					"start_script":   `exec "$REDEVEN_INSTALL_EXECUTABLE" web --host "$REDEVEN_SERVICE_HOST" --port "$REDEVEN_SERVICE_PORT" --no-open`,
					"runtime_bundle": "deepseek-harness-" + strings.TrimSpace(version) + "-node-24.19.0",
				},
			}
		case "deepseek-harness-container":
			if registryExactImageReference(artifact) == "" {
				return "", "", fmt.Errorf("managed Web Service %s template spec v2 migration: exact DeepSeek container artifact is required", owner)
			}
			document = map[string]any{
				"schema_version": 1, "kind": "container",
				"endpoint":  map[string]any{"scheme": "http", "container_port": 3080, "path": "/", "health_path": "/", "startup_timeout_sec": 45},
				"container": map[string]any{"image": artifact, "read_only_root": true},
			}
		default:
			return "", "", fmt.Errorf("managed Web Service %s template spec v2 migration: empty historical snapshot is ambiguous", owner)
		}
	}
	// Historical built-in Host snapshots are authoritative for user scripts,
	// while the package driver was previously implied by the template identity.
	// Materialize that one implicit product contract without changing any Hook.
	if templateID == "deepseek-harness-host" && (deployment == "native" || deployment == "host") {
		host, ok := document["host"].(map[string]any)
		if !ok {
			return "", "", fmt.Errorf("managed Web Service %s template spec v2 migration: DeepSeek Host snapshot is invalid", owner)
		}
		if _, hasBundle := host["runtime_bundle"]; !hasBundle {
			host["runtime_bundle"] = "deepseek-harness-" + strings.TrimSpace(version) + "-node-24.19.0"
		}
	}
	encodedV1, err := json.Marshal(document)
	if err != nil {
		return "", "", err
	}
	return migrateRegistryTemplateSpecV2(owner, version, string(encodedV1))
}

func registryExactImageReference(reference string) string {
	reference = strings.TrimSpace(reference)
	_, digest, ok := strings.Cut(reference, "@")
	if !ok || !strings.HasPrefix(digest, "sha256:") || len(digest) != len("sha256:")+64 {
		return ""
	}
	for _, char := range strings.TrimPrefix(digest, "sha256:") {
		if !strings.ContainsRune("0123456789abcdefABCDEF", char) {
			return ""
		}
	}
	return reference
}

func registryImageRepository(reference string) string {
	reference = strings.TrimSpace(reference)
	if before, _, ok := strings.Cut(reference, "@"); ok {
		reference = before
	}
	lastSlash := strings.LastIndex(reference, "/")
	lastColon := strings.LastIndex(reference, ":")
	if lastColon > lastSlash {
		reference = reference[:lastColon]
	}
	return strings.TrimSpace(reference)
}

func registryImageTag(reference string) string {
	lastSlash := strings.LastIndex(reference, "/")
	lastColon := strings.LastIndex(reference, ":")
	if lastColon > lastSlash {
		return strings.TrimSpace(reference[lastColon+1:])
	}
	return ""
}

func migrateRegistryToV7(tx *sql.Tx) error {
	if err := verifyRegistryShape(tx, []string{"forward_id", "target_url", "name", "description", "health_path", "insecure_skip_verify", "created_at_unix_ms", "updated_at_unix_ms", "last_opened_at_unix_ms", "access_mode"}, "v6"); err != nil {
		return err
	}
	_, err := tx.Exec(`
UPDATE managed_web_services
SET service_family_id='deepseek-harness-host'
WHERE template_source='builtin'
  AND template_id='deepseek-harness-host'
  AND service_family_id='deepseek-harness';
UPDATE managed_web_services
SET service_family_id='deepseek-harness-container'
WHERE template_source='builtin'
  AND template_id='deepseek-harness-container'
  AND service_family_id='deepseek-harness';
`)
	return err
}

func migrateRegistryToV6(tx *sql.Tx) error {
	if err := verifyRegistryShape(tx, []string{"forward_id", "target_url", "name", "description", "health_path", "insecure_skip_verify", "created_at_unix_ms", "updated_at_unix_ms", "last_opened_at_unix_ms", "access_mode"}, "v5"); err != nil {
		return err
	}
	_, err := tx.Exec(`
ALTER TABLE managed_web_service_operations
ADD COLUMN progress_detail_json TEXT NOT NULL DEFAULT '{"schema_version":1}';
`)
	return err
}

type legacyManagedServiceConfiguration struct {
	Parameters              map[string]string `json:"parameters,omitempty"`
	AcceptedNoticeRevisions map[string]int64  `json:"accepted_notice_revisions,omitempty"`
}

type managedServiceConfigurationV2 struct {
	SchemaVersion           int               `json:"schema_version"`
	Parameters              map[string]string `json:"parameters,omitempty"`
	AcceptedNoticeRevisions map[string]int64  `json:"accepted_notice_revisions,omitempty"`
}

func migrateRegistryToV5(tx *sql.Tx) error {
	if err := verifyRegistryShape(tx, []string{"forward_id", "target_url", "name", "description", "health_path", "insecure_skip_verify", "created_at_unix_ms", "updated_at_unix_ms", "last_opened_at_unix_ms", "access_mode"}, "v4"); err != nil {
		return err
	}
	rows, err := tx.Query(`SELECT service_id, configuration_json FROM managed_web_services ORDER BY service_id`)
	if err != nil {
		return err
	}
	type migratedConfiguration struct{ serviceID, encoded, digest string }
	var migrated []migratedConfiguration
	for rows.Next() {
		var serviceID, raw string
		if err := rows.Scan(&serviceID, &raw); err != nil {
			_ = rows.Close()
			return err
		}
		legacy := legacyManagedServiceConfiguration{}
		if strings.TrimSpace(raw) != "" && strings.TrimSpace(raw) != "{}" {
			decoder := json.NewDecoder(strings.NewReader(raw))
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(&legacy); err != nil {
				_ = rows.Close()
				return fmt.Errorf("managed Web Service %s configuration migration: %w", serviceID, err)
			}
		}
		current := managedServiceConfigurationV2{SchemaVersion: 2, Parameters: legacy.Parameters, AcceptedNoticeRevisions: legacy.AcceptedNoticeRevisions}
		encoded, err := json.Marshal(current)
		if err != nil {
			_ = rows.Close()
			return err
		}
		sum := sha256.Sum256(encoded)
		migrated = append(migrated, migratedConfiguration{serviceID: serviceID, encoded: string(encoded), digest: hex.EncodeToString(sum[:])})
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if err := rows.Err(); err != nil {
		return err
	}
	serviceSpecs, err := migrateRegistryRuntimeSpecs(tx, `SELECT service_id, template_snapshot_json FROM managed_web_services ORDER BY service_id`)
	if err != nil {
		return err
	}
	templateSpecs, err := migrateRegistryRuntimeSpecs(tx, `SELECT template_id, spec_json FROM managed_web_service_templates ORDER BY template_id`)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(`
ALTER TABLE managed_web_services ADD COLUMN configuration_revision INTEGER NOT NULL DEFAULT 1 CHECK(configuration_revision > 0);
ALTER TABLE managed_web_services ADD COLUMN configuration_sha256 TEXT NOT NULL DEFAULT '';
CREATE TABLE managed_web_service_resources (
  service_id TEXT NOT NULL REFERENCES managed_web_services(service_id) ON DELETE CASCADE,
  resource_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  engine_identity TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL,
  PRIMARY KEY(service_id, resource_id)
);
`); err != nil {
		return err
	}
	for _, item := range migrated {
		if _, err := tx.Exec(`UPDATE managed_web_services SET configuration_json=?, configuration_sha256=? WHERE service_id=?`, item.encoded, item.digest, item.serviceID); err != nil {
			return err
		}
	}
	for _, item := range serviceSpecs {
		if _, err := tx.Exec(`UPDATE managed_web_services SET template_snapshot_json=?, template_snapshot_sha256=? WHERE service_id=?`, item.encoded, item.digest, item.owner); err != nil {
			return err
		}
	}
	for _, item := range templateSpecs {
		if _, err := tx.Exec(`UPDATE managed_web_service_templates SET spec_json=?, spec_sha256=? WHERE template_id=?`, item.encoded, item.digest, item.owner); err != nil {
			return err
		}
	}
	return nil
}

type registryMigratedRuntimeSpec struct{ owner, encoded, digest string }

func migrateRegistryRuntimeSpecs(tx *sql.Tx, query string) ([]registryMigratedRuntimeSpec, error) {
	rows, err := tx.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []registryMigratedRuntimeSpec
	for rows.Next() {
		var owner, raw string
		if err := rows.Scan(&owner, &raw); err != nil {
			return nil, err
		}
		var document map[string]any
		if err := json.Unmarshal([]byte(raw), &document); err != nil {
			return nil, fmt.Errorf("managed Web Service %s runtime spec migration: %w", owner, err)
		}
		container, _ := document["container"].(map[string]any)
		for _, kind := range []string{"mounts", "ports", "devices"} {
			items, _ := container[kind].([]any)
			for index, rawItem := range items {
				item, ok := rawItem.(map[string]any)
				resourceID, hasResourceID := item["resource_id"].(string)
				if !ok || hasResourceID && strings.TrimSpace(resourceID) != "" {
					continue
				}
				canonical, err := json.Marshal(item)
				if err != nil {
					return nil, err
				}
				sum := sha256.Sum256([]byte(owner + "\n" + kind + "\n" + fmt.Sprint(index) + "\n" + string(canonical)))
				item["resource_id"] = "legacy-" + strings.TrimSuffix(kind, "s") + "-" + hex.EncodeToString(sum[:6])
			}
		}
		encoded, err := json.Marshal(document)
		if err != nil {
			return nil, err
		}
		sum := sha256.Sum256(encoded)
		result = append(result, registryMigratedRuntimeSpec{owner: owner, encoded: string(encoded), digest: hex.EncodeToString(sum[:])})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func migrateRegistryToV4(tx *sql.Tx) error {
	if err := verifyRegistryShape(tx, []string{"forward_id", "target_url", "name", "description", "health_path", "insecure_skip_verify", "created_at_unix_ms", "updated_at_unix_ms", "last_opened_at_unix_ms"}, "v3"); err != nil {
		return err
	}
	_, err := tx.Exec(`
ALTER TABLE port_forwards ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'unified_proxy'
  CHECK(access_mode IN ('unified_proxy','desktop_loopback'));
UPDATE port_forwards
SET access_mode='desktop_loopback'
WHERE forward_id IN (
  SELECT forward_id FROM managed_web_services WHERE service_family_id='deepseek-harness'
);
`)
	return err
}

func migrateRegistryToV3(tx *sql.Tx) error {
	if err := verifyRegistryV2Source(tx); err != nil {
		return err
	}
	_, err := tx.Exec(`
CREATE TABLE managed_web_service_templates (
  template_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  deployment TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL,
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
CREATE TABLE managed_web_services_v3 (
  service_id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL UNIQUE,
  template_source TEXT NOT NULL,
  template_revision INTEGER NOT NULL,
  template_snapshot_json TEXT NOT NULL,
  template_snapshot_sha256 TEXT NOT NULL,
  service_family_id TEXT NOT NULL UNIQUE,
  deployment TEXT NOT NULL,
  workspace_path TEXT NOT NULL,
  configuration_json TEXT NOT NULL DEFAULT '{}',
  version TEXT NOT NULL,
  desired_state TEXT NOT NULL,
  observed_state TEXT NOT NULL,
  forward_id TEXT NOT NULL UNIQUE REFERENCES port_forwards(forward_id) ON DELETE RESTRICT,
  runtime_identity TEXT NOT NULL DEFAULT '',
  runtime_manifest_json TEXT NOT NULL DEFAULT '{}',
  runtime_port INTEGER NOT NULL DEFAULT 0,
  artifact_reference TEXT NOT NULL DEFAULT '',
  last_error_code TEXT NOT NULL DEFAULT '',
  last_error_message TEXT NOT NULL DEFAULT '',
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL
);
INSERT INTO managed_web_services_v3(
  service_id,template_id,template_source,template_revision,template_snapshot_json,template_snapshot_sha256,service_family_id,
  deployment,workspace_path,configuration_json,version,desired_state,observed_state,forward_id,runtime_identity,runtime_manifest_json,
  runtime_port,artifact_reference,last_error_code,last_error_message,created_at_unix_ms,updated_at_unix_ms
)
SELECT
  service_id,
  CASE WHEN template_id='deepseek-harness' AND deployment='docker' THEN 'deepseek-harness-container'
       WHEN template_id='deepseek-harness' THEN 'deepseek-harness-host'
       ELSE template_id END,
  'builtin',1,'{}','',
  CASE WHEN template_id='deepseek-harness' THEN 'deepseek-harness' ELSE template_id END,
  deployment,workspace_path,'{}',version,desired_state,observed_state,forward_id,runtime_identity,'{}',
  runtime_port,artifact_reference,last_error_code,last_error_message,created_at_unix_ms,updated_at_unix_ms
FROM managed_web_services;
DROP TABLE managed_web_services;
ALTER TABLE managed_web_services_v3 RENAME TO managed_web_services;
`)
	return err
}

func migrateRegistryToV2(tx *sql.Tx) error {
	if err := verifyRegistryV1Source(tx); err != nil {
		return err
	}
	_, err := tx.Exec(`
CREATE TABLE managed_web_services (
  service_id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL UNIQUE,
  deployment TEXT NOT NULL,
  workspace_path TEXT NOT NULL,
  version TEXT NOT NULL,
  desired_state TEXT NOT NULL,
  observed_state TEXT NOT NULL,
  forward_id TEXT NOT NULL UNIQUE REFERENCES port_forwards(forward_id) ON DELETE RESTRICT,
  runtime_identity TEXT NOT NULL DEFAULT '',
  runtime_port INTEGER NOT NULL DEFAULT 0,
  artifact_reference TEXT NOT NULL DEFAULT '',
  last_error_code TEXT NOT NULL DEFAULT '',
  last_error_message TEXT NOT NULL DEFAULT '',
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL
);
CREATE TABLE managed_web_service_operations (
  operation_id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  action TEXT NOT NULL,
  delete_data INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL,
  stage TEXT NOT NULL,
  progress_current INTEGER NOT NULL DEFAULT 0,
  progress_total INTEGER NOT NULL DEFAULT 0,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  finished_at_unix_ms INTEGER NOT NULL DEFAULT 0
);
`)
	return err
}

func verifyRegistryV1Source(tx *sql.Tx) error {
	tables, err := sqliteutil.ListUserTablesTx(tx)
	if err != nil {
		return err
	}
	if !slices.Equal(tables, []string{"port_forwards"}) {
		return fmt.Errorf("port forward registry v1 table set mismatch: got %v", tables)
	}
	columns, err := sqliteutil.TableColumnNamesTx(tx, "port_forwards")
	if err != nil {
		return err
	}
	want := []string{"forward_id", "target_url", "name", "description", "health_path", "insecure_skip_verify", "created_at_unix_ms", "updated_at_unix_ms", "last_opened_at_unix_ms"}
	if !slices.Equal(columns, want) {
		return fmt.Errorf("port forward registry v1 column mismatch: got %v, want %v", columns, want)
	}
	return verifyNoRegistryIndexes(tx, "v1")
}

func verifyRegistryV2Source(tx *sql.Tx) error {
	tables, err := sqliteutil.ListUserTablesTx(tx)
	if err != nil {
		return err
	}
	if !slices.Equal(tables, []string{"managed_web_service_operations", "managed_web_services", "port_forwards"}) {
		return fmt.Errorf("port forward registry v2 table set mismatch: got %v", tables)
	}
	expected := map[string][]string{
		"port_forwards":                  {"forward_id", "target_url", "name", "description", "health_path", "insecure_skip_verify", "created_at_unix_ms", "updated_at_unix_ms", "last_opened_at_unix_ms"},
		"managed_web_services":           {"service_id", "template_id", "deployment", "workspace_path", "version", "desired_state", "observed_state", "forward_id", "runtime_identity", "runtime_port", "artifact_reference", "last_error_code", "last_error_message", "created_at_unix_ms", "updated_at_unix_ms"},
		"managed_web_service_operations": {"operation_id", "service_id", "request_id", "request_fingerprint", "action", "delete_data", "state", "stage", "progress_current", "progress_total", "cancel_requested", "error_code", "error_message", "created_at_unix_ms", "updated_at_unix_ms", "finished_at_unix_ms"},
	}
	for table, want := range expected {
		columns, err := sqliteutil.TableColumnNamesTx(tx, table)
		if err != nil {
			return err
		}
		if !slices.Equal(columns, want) {
			return fmt.Errorf("port forward registry v2 %s column mismatch: got %v, want %v", table, columns, want)
		}
	}
	return verifyNoRegistryIndexes(tx, "v2")
}

func verifyNoRegistryIndexes(tx *sql.Tx, version string) error {
	indexes, err := sqliteutil.ListUserIndexesTx(tx)
	if err != nil {
		return err
	}
	if len(indexes) != 0 {
		return fmt.Errorf("port forward registry %s has unexpected indexes %v", version, indexes)
	}
	return nil
}

func migrateRegistryToV1(tx *sql.Tx) error {
	_, err := tx.Exec(`
	CREATE TABLE port_forwards (
  forward_id TEXT PRIMARY KEY,
  target_url TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  health_path TEXT NOT NULL DEFAULT '',
  insecure_skip_verify INTEGER NOT NULL DEFAULT 0,
  created_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  last_opened_at_unix_ms INTEGER NOT NULL
);
`)
	return err
}

func verifyRegistrySchema(tx *sql.Tx) error {
	if err := verifyRegistryShape(tx, []string{"forward_id", "target_url", "name", "description", "health_path", "insecure_skip_verify", "created_at_unix_ms", "updated_at_unix_ms", "last_opened_at_unix_ms", "access_mode"}, "v8"); err != nil {
		return err
	}
	if err := verifyRegistryAccessModeColumn(tx); err != nil {
		return err
	}
	if err := verifyRegistryProgressDetailColumn(tx); err != nil {
		return err
	}
	if err := verifyRegistryReleaseIdentityColumns(tx); err != nil {
		return err
	}
	if err := verifyRegistryManagedDocumentDigests(tx); err != nil {
		return err
	}
	if err := verifyRegistryV8Documents(tx); err != nil {
		return err
	}
	if err := verifyRegistryManagedServiceDeployments(tx); err != nil {
		return err
	}
	if err := verifyRegistryDeepSeekServiceFamilies(tx); err != nil {
		return err
	}
	var invalid int
	if err := tx.QueryRow(`SELECT COUNT(1) FROM port_forwards WHERE access_mode NOT IN ('unified_proxy','desktop_loopback')`).Scan(&invalid); err != nil {
		return err
	}
	if invalid != 0 {
		return fmt.Errorf("port forward registry has %d invalid access modes", invalid)
	}
	return nil
}

func verifyRegistryV8Documents(tx *sql.Tx) error {
	rows, err := tx.Query(`
SELECT 'template',template_id,spec_json,'' AS release_identity_json,'' AS release_identity_sha256
FROM managed_web_service_templates
UNION ALL
SELECT 'service',service_id,template_snapshot_json,release_identity_json,release_identity_sha256
FROM managed_web_services
ORDER BY 1,2`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var kind, owner, specRaw, releaseRaw, releaseDigest string
		if err := rows.Scan(&kind, &owner, &specRaw, &releaseRaw, &releaseDigest); err != nil {
			return err
		}
		if _, err := decodeRegistryTemplateSpec(specRaw, 2); err != nil {
			return fmt.Errorf("managed Web Service %s %s template spec: %w", kind, owner, err)
		}
		if kind != "service" {
			continue
		}
		if err := verifyRegistryDocumentDigest("managed Web Service release identity", owner, releaseRaw, releaseDigest); err != nil {
			return err
		}
		var identity registryReleaseIdentityV1
		decoder := json.NewDecoder(strings.NewReader(releaseRaw))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&identity); err != nil {
			return fmt.Errorf("managed Web Service release identity %s: %w", owner, err)
		}
		if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
			return fmt.Errorf("managed Web Service release identity %s contains trailing JSON", owner)
		}
		if identity.SchemaVersion != 1 || strings.TrimSpace(identity.Kind) == "" {
			return fmt.Errorf("managed Web Service release identity %s is unsupported", owner)
		}
	}
	return rows.Err()
}

func verifyRegistryManagedServiceDeployments(tx *sql.Tx) error {
	var invalid int
	if err := tx.QueryRow(`
SELECT COUNT(1)
FROM managed_web_services
WHERE deployment NOT IN ('host','container','compose')
`).Scan(&invalid); err != nil {
		return err
	}
	if invalid != 0 {
		return fmt.Errorf("managed Web Service registry has %d unsupported deployment kinds", invalid)
	}
	return nil
}

func verifyRegistryReleaseIdentityColumns(tx *sql.Tx) error {
	expected := map[string]string{
		"release_identity_json":   "'{\"schema_version\":1,\"kind\":\"none\"}'",
		"release_identity_sha256": "''",
	}
	rows, err := tx.Query("PRAGMA table_info(managed_web_services)")
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, columnType string
		var defaultValue any
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			return err
		}
		want, relevant := expected[name]
		if !relevant {
			continue
		}
		defaultText, ok := defaultValue.(string)
		if !ok || strings.ToUpper(strings.TrimSpace(columnType)) != "TEXT" || notNull != 1 || primaryKey != 0 || defaultText != want {
			return fmt.Errorf("port forward registry v8 %s definition mismatch", name)
		}
		delete(expected, name)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if len(expected) != 0 {
		return fmt.Errorf("port forward registry v8 release identity columns are missing")
	}
	return nil
}

func verifyRegistryDeepSeekServiceFamilies(tx *sql.Tx) error {
	var invalid int
	err := tx.QueryRow(`
SELECT COUNT(1)
FROM managed_web_services
WHERE template_source='builtin'
  AND ((template_id='deepseek-harness-host' AND service_family_id<>'deepseek-harness-host')
    OR (template_id='deepseek-harness-container' AND service_family_id<>'deepseek-harness-container'))
`).Scan(&invalid)
	if err != nil {
		return err
	}
	if invalid != 0 {
		return fmt.Errorf("managed Web Service registry has %d invalid DeepSeek Harness service families", invalid)
	}
	return nil
}

func verifyRegistryProgressDetailColumn(tx *sql.Tx) error {
	rows, err := tx.Query(`PRAGMA table_info(managed_web_service_operations)`)
	if err != nil {
		return err
	}
	found := false
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, columnType string
		var defaultValue any
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			_ = rows.Close()
			return err
		}
		if name != "progress_detail_json" {
			continue
		}
		defaultText, ok := defaultValue.(string)
		if !ok || strings.ToUpper(strings.TrimSpace(columnType)) != "TEXT" || notNull != 1 || primaryKey != 0 || defaultText != `'{"schema_version":1}'` {
			_ = rows.Close()
			return fmt.Errorf("port forward registry v6 progress_detail_json definition mismatch")
		}
		found = true
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if !found {
		return fmt.Errorf("port forward registry v6 progress_detail_json definition is missing")
	}
	detailRows, err := tx.Query(`SELECT operation_id, progress_detail_json FROM managed_web_service_operations ORDER BY operation_id`)
	if err != nil {
		return err
	}
	defer detailRows.Close()
	for detailRows.Next() {
		var operationID, raw string
		if err := detailRows.Scan(&operationID, &raw); err != nil {
			return err
		}
		if _, _, err := decodeManagedOperationProgressDetail(raw); err != nil {
			return fmt.Errorf("managed Web Service operation %s progress detail: %w", operationID, err)
		}
	}
	return detailRows.Err()
}

func verifyRegistryManagedDocumentDigests(tx *sql.Tx) error {
	templateRows, err := tx.Query(`SELECT template_id, spec_json, spec_sha256 FROM managed_web_service_templates ORDER BY template_id`)
	if err != nil {
		return err
	}
	for templateRows.Next() {
		var owner, raw, digest string
		if err := templateRows.Scan(&owner, &raw, &digest); err != nil {
			_ = templateRows.Close()
			return err
		}
		if err := verifyRegistryDocumentDigest("managed Web Service template", owner, raw, digest); err != nil {
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

	serviceRows, err := tx.Query(`SELECT service_id, template_snapshot_json, template_snapshot_sha256, configuration_json, configuration_sha256 FROM managed_web_services ORDER BY service_id`)
	if err != nil {
		return err
	}
	defer serviceRows.Close()
	for serviceRows.Next() {
		var owner, snapshot, snapshotDigest, configuration, configurationDigest string
		if err := serviceRows.Scan(&owner, &snapshot, &snapshotDigest, &configuration, &configurationDigest); err != nil {
			return err
		}
		if snapshot != "" || snapshotDigest != "" {
			if err := verifyRegistryDocumentDigest("managed Web Service template snapshot", owner, snapshot, snapshotDigest); err != nil {
				return err
			}
		}
		if err := verifyRegistryDocumentDigest("managed Web Service configuration", owner, configuration, configurationDigest); err != nil {
			return err
		}
	}
	return serviceRows.Err()
}

func verifyRegistryDocumentDigest(kind, owner, raw, expected string) error {
	digest := sha256.Sum256([]byte(raw))
	actual := hex.EncodeToString(digest[:])
	if expected != actual {
		return fmt.Errorf("%s %s SHA-256 mismatch", kind, owner)
	}
	return nil
}

func verifyRegistryAccessModeColumn(tx *sql.Tx) error {
	rows, err := tx.Query(`PRAGMA table_info(port_forwards)`)
	if err != nil {
		return err
	}
	defer rows.Close()
	found := false
	for rows.Next() {
		var (
			cid          int
			name         string
			columnType   string
			notNull      int
			defaultValue any
			primaryKey   int
		)
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			return err
		}
		if name != "access_mode" {
			continue
		}
		defaultText, ok := defaultValue.(string)
		if !ok || strings.ToUpper(strings.TrimSpace(columnType)) != "TEXT" || notNull != 1 || primaryKey != 0 || defaultText != "'unified_proxy'" {
			return fmt.Errorf("port forward registry v4 access_mode definition mismatch")
		}
		found = true
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if !found {
		return fmt.Errorf("port forward registry v4 access_mode definition is missing")
	}
	var createSQL string
	if err := tx.QueryRow(`SELECT sql FROM sqlite_master WHERE type='table' AND name='port_forwards'`).Scan(&createSQL); err != nil {
		return err
	}
	normalized := strings.ToLower(strings.Join(strings.Fields(createSQL), ""))
	if !strings.Contains(normalized, "check(access_modein('unified_proxy','desktop_loopback'))") {
		return fmt.Errorf("port forward registry v4 access_mode constraint mismatch")
	}
	return nil
}

func verifyRegistryShape(tx *sql.Tx, expectedColumns []string, version string) error {
	tables, err := sqliteutil.ListUserTablesTx(tx)
	if err != nil {
		return err
	}
	expectedTables := []string{"managed_web_service_operations", "managed_web_service_template_requests", "managed_web_service_templates", "managed_web_services", "port_forwards"}
	if version == "v5" || version == "v6" || version == "v7" || version == "v8" {
		expectedTables = []string{"managed_web_service_operations", "managed_web_service_resources", "managed_web_service_template_requests", "managed_web_service_templates", "managed_web_services", "port_forwards"}
	}
	if !slices.Equal(tables, expectedTables) {
		return fmt.Errorf("port forward registry table set mismatch: got %v", tables)
	}
	columns, err := sqliteutil.TableColumnNamesTx(tx, "port_forwards")
	if err != nil {
		return err
	}
	if !slices.Equal(columns, expectedColumns) {
		return fmt.Errorf("port forward registry %s column mismatch: got %v, want %v", version, columns, expectedColumns)
	}
	templateColumns := []string{"template_id", "name", "description", "source", "deployment", "version", "revision", "spec_json", "spec_sha256", "derived_from_template_id", "derived_from_revision", "service_family_id", "created_at_unix_ms", "updated_at_unix_ms"}
	columns, err = sqliteutil.TableColumnNamesTx(tx, "managed_web_service_templates")
	if err != nil {
		return err
	}
	if !slices.Equal(columns, templateColumns) {
		return fmt.Errorf("managed Web Service template column mismatch: got %v, want %v", columns, templateColumns)
	}
	templateRequestColumns := []string{"request_id", "request_fingerprint", "template_id", "action", "created_at_unix_ms"}
	columns, err = sqliteutil.TableColumnNamesTx(tx, "managed_web_service_template_requests")
	if err != nil {
		return err
	}
	if !slices.Equal(columns, templateRequestColumns) {
		return fmt.Errorf("managed Web Service template request column mismatch: got %v, want %v", columns, templateRequestColumns)
	}
	managedServiceColumns := []string{"service_id", "template_id", "template_source", "template_revision", "template_snapshot_json", "template_snapshot_sha256", "service_family_id", "deployment", "workspace_path", "configuration_json", "version", "desired_state", "observed_state", "forward_id", "runtime_identity", "runtime_manifest_json", "runtime_port", "artifact_reference", "last_error_code", "last_error_message", "created_at_unix_ms", "updated_at_unix_ms"}
	if version == "v5" || version == "v6" || version == "v7" || version == "v8" {
		managedServiceColumns = append(managedServiceColumns, "configuration_revision", "configuration_sha256")
	}
	if version == "v8" {
		managedServiceColumns = append(managedServiceColumns, "release_identity_json", "release_identity_sha256")
	}
	columns, err = sqliteutil.TableColumnNamesTx(tx, "managed_web_services")
	if err != nil {
		return err
	}
	if !slices.Equal(columns, managedServiceColumns) {
		return fmt.Errorf("managed web service column mismatch: got %v, want %v", columns, managedServiceColumns)
	}
	operationColumns := []string{"operation_id", "service_id", "request_id", "request_fingerprint", "action", "delete_data", "state", "stage", "progress_current", "progress_total", "cancel_requested", "error_code", "error_message", "created_at_unix_ms", "updated_at_unix_ms", "finished_at_unix_ms"}
	if version == "v6" || version == "v7" || version == "v8" {
		operationColumns = append(operationColumns, "progress_detail_json")
	}
	columns, err = sqliteutil.TableColumnNamesTx(tx, "managed_web_service_operations")
	if err != nil {
		return err
	}
	if !slices.Equal(columns, operationColumns) {
		return fmt.Errorf("managed web service operation column mismatch: got %v, want %v", columns, operationColumns)
	}
	if version == "v5" || version == "v6" || version == "v7" || version == "v8" {
		resourceColumns := []string{"service_id", "resource_id", "kind", "engine_identity", "created_at_unix_ms"}
		columns, err = sqliteutil.TableColumnNamesTx(tx, "managed_web_service_resources")
		if err != nil {
			return err
		}
		if !slices.Equal(columns, resourceColumns) {
			return fmt.Errorf("managed web service resource column mismatch: got %v, want %v", columns, resourceColumns)
		}
		var invalidConfiguration int
		if err := tx.QueryRow(`SELECT COUNT(1) FROM managed_web_services WHERE configuration_revision <= 0 OR length(configuration_sha256) <> 64`).Scan(&invalidConfiguration); err != nil {
			return err
		}
		if invalidConfiguration != 0 {
			return fmt.Errorf("managed Web Service registry has %d invalid configuration identities", invalidConfiguration)
		}
	}
	indexes, err := sqliteutil.ListUserIndexesTx(tx)
	if err != nil {
		return err
	}
	if len(indexes) != 0 {
		return fmt.Errorf("port forward registry %s has unexpected indexes %v", version, indexes)
	}
	return nil
}
