package registry

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"
)

var (
	ErrManagedServiceNotFound      = errors.New("managed web service not found")
	ErrManagedForward              = errors.New("managed port forward can only be removed by uninstalling its service")
	ErrManagedTemplateNotFound     = errors.New("managed web service template not found")
	ErrManagedTemplateNameConflict = errors.New("managed web service template name already exists")
	ErrManagedTemplateInUse        = errors.New("managed web service template has an installed service")
)

type ManagedTemplate struct {
	TemplateID            string `json:"template_id"`
	Name                  string `json:"name"`
	Description           string `json:"description"`
	Source                string `json:"source"`
	Deployment            string `json:"deployment"`
	Version               string `json:"version"`
	Revision              int64  `json:"revision"`
	SpecJSON              string `json:"-"`
	SpecSHA256            string `json:"spec_sha256"`
	DerivedFromTemplateID string `json:"derived_from_template_id,omitempty"`
	DerivedFromRevision   int64  `json:"derived_from_revision,omitempty"`
	ServiceFamilyID       string `json:"service_family_id"`
	CreatedAtUnixMs       int64  `json:"created_at_unix_ms"`
	UpdatedAtUnixMs       int64  `json:"updated_at_unix_ms"`
}

type ManagedTemplateRequest struct {
	RequestID          string
	RequestFingerprint string
	TemplateID         string
	Action             string
	CreatedAtUnixMs    int64
}

type ManagedService struct {
	ServiceID              string `json:"service_id"`
	TemplateID             string `json:"template_id"`
	TemplateSource         string `json:"template_source"`
	TemplateRevision       int64  `json:"template_revision"`
	TemplateSnapshotJSON   string `json:"-"`
	TemplateSnapshotSHA256 string `json:"template_snapshot_sha256"`
	ServiceFamilyID        string `json:"service_family_id"`
	Deployment             string `json:"deployment"`
	WorkspacePath          string `json:"workspace_path"`
	ConfigurationJSON      string `json:"-"`
	ConfigurationRevision  int64  `json:"configuration_revision"`
	ConfigurationSHA256    string `json:"configuration_sha256"`
	Version                string `json:"version"`
	DesiredState           string `json:"desired_state"`
	ObservedState          string `json:"observed_state"`
	ForwardID              string `json:"forward_id"`
	RuntimeIdentity        string `json:"runtime_identity,omitempty"`
	RuntimeManifestJSON    string `json:"-"`
	RuntimePort            int    `json:"runtime_port,omitempty"`
	ArtifactReference      string `json:"artifact_reference,omitempty"`
	LastErrorCode          string `json:"last_error_code,omitempty"`
	LastErrorMessage       string `json:"last_error_message,omitempty"`
	CreatedAtUnixMs        int64  `json:"created_at_unix_ms"`
	UpdatedAtUnixMs        int64  `json:"updated_at_unix_ms"`
}

type ManagedOperation struct {
	OperationID        string                          `json:"operation_id"`
	ServiceID          string                          `json:"service_id"`
	RequestID          string                          `json:"request_id"`
	RequestFingerprint string                          `json:"-"`
	Action             string                          `json:"action"`
	DeleteData         bool                            `json:"delete_data,omitempty"`
	State              string                          `json:"state"`
	Stage              string                          `json:"stage"`
	ProgressCurrent    int64                           `json:"progress_current"`
	ProgressTotal      int64                           `json:"progress_total"`
	ProgressDetail     *ManagedOperationProgressDetail `json:"progress_detail,omitempty"`
	CancelRequested    bool                            `json:"cancel_requested"`
	ErrorCode          string                          `json:"error_code,omitempty"`
	ErrorMessage       string                          `json:"error_message,omitempty"`
	CreatedAtUnixMs    int64                           `json:"created_at_unix_ms"`
	UpdatedAtUnixMs    int64                           `json:"updated_at_unix_ms"`
	FinishedAtUnixMs   int64                           `json:"finished_at_unix_ms,omitempty"`
}

const ManagedOperationProgressDetailSchemaVersion = 1

const emptyManagedOperationProgressDetailJSON = `{"schema_version":1}`

const managedOperationSelectColumns = "operation_id,service_id,request_id,request_fingerprint,action,delete_data,state,stage,progress_current,progress_total,cancel_requested,error_code,error_message,created_at_unix_ms,updated_at_unix_ms,finished_at_unix_ms,progress_detail_json"

type ManagedOperationProgressDetail struct {
	SchemaVersion        int                               `json:"schema_version"`
	StageStartedAtUnixMs int64                             `json:"stage_started_at_unix_ms,omitempty"`
	UpdatedAtUnixMs      int64                             `json:"updated_at_unix_ms,omitempty"`
	Transfer             *ManagedOperationTransferProgress `json:"transfer,omitempty"`
}

type ManagedOperationTransferProgress struct {
	Phase             string `json:"phase,omitempty"`
	ArtifactReference string `json:"artifact_reference,omitempty"`
	ArtifactIndex     int64  `json:"artifact_index,omitempty"`
	ArtifactTotal     int64  `json:"artifact_total,omitempty"`
	DownloadedBytes   int64  `json:"downloaded_bytes,omitempty"`
	TotalBytes        int64  `json:"total_bytes,omitempty"`
	BytesPerSecond    int64  `json:"bytes_per_second,omitempty"`
	CompletedLayers   int64  `json:"completed_layers,omitempty"`
	TotalLayers       int64  `json:"total_layers,omitempty"`
}

func canonicalManagedOperationProgressDetail(detail ManagedOperationProgressDetail) (ManagedOperationProgressDetail, string, error) {
	if detail.SchemaVersion == 0 {
		detail.SchemaVersion = ManagedOperationProgressDetailSchemaVersion
	}
	if detail.SchemaVersion != ManagedOperationProgressDetailSchemaVersion {
		return ManagedOperationProgressDetail{}, "", fmt.Errorf("unsupported schema_version %d", detail.SchemaVersion)
	}
	if detail.StageStartedAtUnixMs < 0 || detail.UpdatedAtUnixMs < 0 {
		return ManagedOperationProgressDetail{}, "", errors.New("progress detail timestamps must not be negative")
	}
	if transfer := detail.Transfer; transfer != nil {
		if transfer.ArtifactIndex < 0 || transfer.ArtifactTotal < 0 || transfer.DownloadedBytes < 0 || transfer.TotalBytes < 0 || transfer.BytesPerSecond < 0 || transfer.CompletedLayers < 0 || transfer.TotalLayers < 0 {
			return ManagedOperationProgressDetail{}, "", errors.New("transfer progress values must not be negative")
		}
		if transfer.ArtifactTotal > 0 && transfer.ArtifactIndex > transfer.ArtifactTotal {
			return ManagedOperationProgressDetail{}, "", errors.New("transfer artifact index exceeds artifact total")
		}
		if transfer.TotalBytes > 0 && transfer.DownloadedBytes > transfer.TotalBytes {
			transfer.DownloadedBytes = transfer.TotalBytes
		}
		if transfer.TotalLayers > 0 && transfer.CompletedLayers > transfer.TotalLayers {
			transfer.CompletedLayers = transfer.TotalLayers
		}
	}
	raw, err := json.Marshal(detail)
	if err != nil {
		return ManagedOperationProgressDetail{}, "", err
	}
	return detail, string(raw), nil
}

func decodeManagedOperationProgressDetail(raw string) (ManagedOperationProgressDetail, string, error) {
	if strings.TrimSpace(raw) == "" {
		return ManagedOperationProgressDetail{}, "", errors.New("progress detail must not be empty")
	}
	decoder := json.NewDecoder(strings.NewReader(strings.TrimSpace(raw)))
	decoder.DisallowUnknownFields()
	detail := ManagedOperationProgressDetail{}
	if err := decoder.Decode(&detail); err != nil {
		return ManagedOperationProgressDetail{}, "", err
	}
	if detail.SchemaVersion != ManagedOperationProgressDetailSchemaVersion {
		return ManagedOperationProgressDetail{}, "", fmt.Errorf("unsupported schema_version %d", detail.SchemaVersion)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			return ManagedOperationProgressDetail{}, "", errors.New("progress detail contains multiple JSON values")
		}
		return ManagedOperationProgressDetail{}, "", err
	}
	return canonicalManagedOperationProgressDetail(detail)
}

type ManagedServicePatch struct {
	TemplateRevision       *int64
	TemplateSnapshotJSON   *string
	TemplateSnapshotSHA256 *string
	ConfigurationJSON      *string
	ConfigurationRevision  *int64
	ConfigurationSHA256    *string
	Version                *string
	DesiredState           *string
	ObservedState          *string
	RuntimeIdentity        *string
	RuntimePort            *int
	ArtifactReference      *string
	RuntimeManifestJSON    *string
	LastErrorCode          *string
	LastErrorMessage       *string
}

type ManagedServiceResource struct {
	ServiceID       string `json:"service_id"`
	ResourceID      string `json:"resource_id"`
	Kind            string `json:"kind"`
	EngineIdentity  string `json:"engine_identity"`
	CreatedAtUnixMs int64  `json:"created_at_unix_ms"`
}

func (r *Registry) ListManagedTemplates(ctx context.Context) ([]ManagedTemplate, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("registry not initialized")
	}
	rows, err := r.db.QueryContext(nonNilContext(ctx), `SELECT template_id,name,description,source,deployment,version,revision,spec_json,spec_sha256,derived_from_template_id,derived_from_revision,service_family_id,created_at_unix_ms,updated_at_unix_ms FROM managed_web_service_templates ORDER BY lower(name), template_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ManagedTemplate{}
	for rows.Next() {
		var value ManagedTemplate
		if err := scanManagedTemplate(rows, &value); err != nil {
			return nil, err
		}
		out = append(out, value)
	}
	return out, rows.Err()
}

func (r *Registry) GetManagedTemplate(ctx context.Context, templateID string) (*ManagedTemplate, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("registry not initialized")
	}
	value := ManagedTemplate{}
	err := scanManagedTemplate(r.db.QueryRowContext(nonNilContext(ctx), `SELECT template_id,name,description,source,deployment,version,revision,spec_json,spec_sha256,derived_from_template_id,derived_from_revision,service_family_id,created_at_unix_ms,updated_at_unix_ms FROM managed_web_service_templates WHERE template_id=?`, strings.TrimSpace(templateID)), &value)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &value, nil
}

func scanManagedTemplate(row rowScanner, value *ManagedTemplate) error {
	return row.Scan(&value.TemplateID, &value.Name, &value.Description, &value.Source, &value.Deployment, &value.Version, &value.Revision, &value.SpecJSON, &value.SpecSHA256, &value.DerivedFromTemplateID, &value.DerivedFromRevision, &value.ServiceFamilyID, &value.CreatedAtUnixMs, &value.UpdatedAtUnixMs)
}

func (r *Registry) CreateManagedTemplate(ctx context.Context, value ManagedTemplate) error {
	return r.createManagedTemplate(ctx, value, nil)
}

func (r *Registry) CreateManagedTemplateWithRequest(ctx context.Context, value ManagedTemplate, request ManagedTemplateRequest) error {
	return r.createManagedTemplate(ctx, value, &request)
}

func (r *Registry) createManagedTemplate(ctx context.Context, value ManagedTemplate, request *ManagedTemplateRequest) error {
	if r == nil || r.db == nil {
		return errors.New("registry not initialized")
	}
	now := time.Now().UnixMilli()
	if value.CreatedAtUnixMs <= 0 {
		value.CreatedAtUnixMs = now
	}
	if value.UpdatedAtUnixMs <= 0 {
		value.UpdatedAtUnixMs = value.CreatedAtUnixMs
	}
	tx, err := r.db.BeginTx(nonNilContext(ctx), nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var count int
	if err := tx.QueryRow(`SELECT COUNT(1) FROM managed_web_service_templates WHERE lower(name)=lower(?)`, strings.TrimSpace(value.Name)).Scan(&count); err != nil {
		return err
	}
	if count != 0 {
		return ErrManagedTemplateNameConflict
	}
	_, err = tx.Exec(`INSERT INTO managed_web_service_templates(template_id,name,description,source,deployment,version,revision,spec_json,spec_sha256,derived_from_template_id,derived_from_revision,service_family_id,created_at_unix_ms,updated_at_unix_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, value.TemplateID, value.Name, value.Description, value.Source, value.Deployment, value.Version, value.Revision, value.SpecJSON, value.SpecSHA256, value.DerivedFromTemplateID, value.DerivedFromRevision, value.ServiceFamilyID, value.CreatedAtUnixMs, value.UpdatedAtUnixMs)
	if err != nil {
		return err
	}
	if request != nil {
		created := request.CreatedAtUnixMs
		if created <= 0 {
			created = now
		}
		if _, err := tx.Exec(`INSERT INTO managed_web_service_template_requests(request_id,request_fingerprint,template_id,action,created_at_unix_ms) VALUES(?,?,?,?,?)`, strings.TrimSpace(request.RequestID), request.RequestFingerprint, value.TemplateID, request.Action, created); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (r *Registry) GetManagedTemplateRequest(ctx context.Context, requestID string) (*ManagedTemplateRequest, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("registry not initialized")
	}
	value := ManagedTemplateRequest{}
	err := r.db.QueryRowContext(nonNilContext(ctx), `SELECT request_id,request_fingerprint,template_id,action,created_at_unix_ms FROM managed_web_service_template_requests WHERE request_id=?`, strings.TrimSpace(requestID)).Scan(&value.RequestID, &value.RequestFingerprint, &value.TemplateID, &value.Action, &value.CreatedAtUnixMs)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &value, nil
}

func (r *Registry) UpdateManagedTemplate(ctx context.Context, value ManagedTemplate) error {
	if r == nil || r.db == nil {
		return errors.New("registry not initialized")
	}
	tx, err := r.db.BeginTx(nonNilContext(ctx), nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var count int
	if err := tx.QueryRow(`SELECT COUNT(1) FROM managed_web_service_templates WHERE lower(name)=lower(?) AND template_id<>?`, strings.TrimSpace(value.Name), strings.TrimSpace(value.TemplateID)).Scan(&count); err != nil {
		return err
	}
	if count != 0 {
		return ErrManagedTemplateNameConflict
	}
	result, err := tx.Exec(`UPDATE managed_web_service_templates SET name=?,description=?,deployment=?,version=?,revision=?,spec_json=?,spec_sha256=?,derived_from_template_id=?,derived_from_revision=?,updated_at_unix_ms=? WHERE template_id=?`, value.Name, value.Description, value.Deployment, value.Version, value.Revision, value.SpecJSON, value.SpecSHA256, value.DerivedFromTemplateID, value.DerivedFromRevision, time.Now().UnixMilli(), strings.TrimSpace(value.TemplateID))
	if err != nil {
		return err
	}
	if affected, err := result.RowsAffected(); err != nil {
		return err
	} else if affected != 1 {
		return ErrManagedTemplateNotFound
	}
	return tx.Commit()
}

func (r *Registry) DeleteManagedTemplate(ctx context.Context, templateID string) error {
	if r == nil || r.db == nil {
		return errors.New("registry not initialized")
	}
	tx, err := r.db.BeginTx(nonNilContext(ctx), nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var count int
	if err := tx.QueryRow(`SELECT COUNT(1) FROM managed_web_services WHERE template_id=?`, strings.TrimSpace(templateID)).Scan(&count); err != nil {
		return err
	}
	if count != 0 {
		return ErrManagedTemplateInUse
	}
	result, err := tx.Exec(`DELETE FROM managed_web_service_templates WHERE template_id=?`, strings.TrimSpace(templateID))
	if err != nil {
		return err
	}
	if affected, err := result.RowsAffected(); err != nil {
		return err
	} else if affected != 1 {
		return ErrManagedTemplateNotFound
	}
	return tx.Commit()
}

func (r *Registry) ListManagedServices(ctx context.Context) ([]ManagedService, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("registry not initialized")
	}
	rows, err := r.db.QueryContext(nonNilContext(ctx), `SELECT service_id,template_id,template_source,template_revision,template_snapshot_json,template_snapshot_sha256,service_family_id,deployment,workspace_path,configuration_json,version,desired_state,observed_state,forward_id,runtime_identity,runtime_manifest_json,runtime_port,artifact_reference,last_error_code,last_error_message,created_at_unix_ms,updated_at_unix_ms,configuration_revision,configuration_sha256 FROM managed_web_services ORDER BY created_at_unix_ms ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ManagedService
	for rows.Next() {
		var value ManagedService
		if err := scanManagedService(rows, &value); err != nil {
			return nil, err
		}
		out = append(out, value)
	}
	return out, rows.Err()
}

func (r *Registry) GetManagedService(ctx context.Context, serviceID string) (*ManagedService, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("registry not initialized")
	}
	value := ManagedService{}
	err := scanManagedService(r.db.QueryRowContext(nonNilContext(ctx), `SELECT service_id,template_id,template_source,template_revision,template_snapshot_json,template_snapshot_sha256,service_family_id,deployment,workspace_path,configuration_json,version,desired_state,observed_state,forward_id,runtime_identity,runtime_manifest_json,runtime_port,artifact_reference,last_error_code,last_error_message,created_at_unix_ms,updated_at_unix_ms,configuration_revision,configuration_sha256 FROM managed_web_services WHERE service_id = ?`, strings.TrimSpace(serviceID)), &value)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &value, nil
}

type rowScanner interface{ Scan(dest ...any) error }

func scanManagedService(row rowScanner, value *ManagedService) error {
	return row.Scan(&value.ServiceID, &value.TemplateID, &value.TemplateSource, &value.TemplateRevision, &value.TemplateSnapshotJSON, &value.TemplateSnapshotSHA256, &value.ServiceFamilyID, &value.Deployment, &value.WorkspacePath, &value.ConfigurationJSON, &value.Version, &value.DesiredState, &value.ObservedState, &value.ForwardID, &value.RuntimeIdentity, &value.RuntimeManifestJSON, &value.RuntimePort, &value.ArtifactReference, &value.LastErrorCode, &value.LastErrorMessage, &value.CreatedAtUnixMs, &value.UpdatedAtUnixMs, &value.ConfigurationRevision, &value.ConfigurationSHA256)
}

func (r *Registry) CreateManagedService(ctx context.Context, service ManagedService, forward Forward) error {
	return r.createManagedService(ctx, service, forward, nil)
}

// CreateManagedServiceWithOperation persists the service, its protected
// forward, and the first lifecycle operation as one unit. This prevents an
// interrupted install request from leaving an instance with no operation that
// the user can inspect or retry.
func (r *Registry) CreateManagedServiceWithOperation(ctx context.Context, service ManagedService, forward Forward, operation ManagedOperation) error {
	return r.createManagedService(ctx, service, forward, &operation)
}

func (r *Registry) createManagedService(ctx context.Context, service ManagedService, forward Forward, operation *ManagedOperation) error {
	if r == nil || r.db == nil {
		return errors.New("registry not initialized")
	}
	now := time.Now().UnixMilli()
	if service.CreatedAtUnixMs <= 0 {
		service.CreatedAtUnixMs = now
	}
	if service.UpdatedAtUnixMs <= 0 {
		service.UpdatedAtUnixMs = service.CreatedAtUnixMs
	}
	if service.ConfigurationRevision <= 0 {
		service.ConfigurationRevision = 1
	}
	if strings.TrimSpace(service.ConfigurationJSON) == "" || strings.TrimSpace(service.ConfigurationJSON) == "{}" {
		service.ConfigurationJSON = `{"schema_version":2}`
	}
	if strings.TrimSpace(service.ConfigurationSHA256) == "" {
		digest := sha256.Sum256([]byte(service.ConfigurationJSON))
		service.ConfigurationSHA256 = hex.EncodeToString(digest[:])
	}
	if forward.CreatedAtUnixMs <= 0 {
		forward.CreatedAtUnixMs = now
	}
	if forward.UpdatedAtUnixMs <= 0 {
		forward.UpdatedAtUnixMs = forward.CreatedAtUnixMs
	}
	operationProgressDetailJSON := emptyManagedOperationProgressDetailJSON
	if operation != nil {
		if operation.CreatedAtUnixMs <= 0 {
			operation.CreatedAtUnixMs = now
		}
		if operation.UpdatedAtUnixMs <= 0 {
			operation.UpdatedAtUnixMs = operation.CreatedAtUnixMs
		}
		if operation.ProgressDetail != nil {
			detail, raw, detailErr := canonicalManagedOperationProgressDetail(*operation.ProgressDetail)
			if detailErr != nil {
				return detailErr
			}
			operation.ProgressDetail, operationProgressDetailJSON = &detail, raw
		}
	}
	tx, err := r.db.BeginTx(nonNilContext(ctx), nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	forward.AccessMode, err = normalizedAccessMode(forward.AccessMode)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(`INSERT INTO port_forwards(forward_id,target_url,name,description,health_path,insecure_skip_verify,created_at_unix_ms,updated_at_unix_ms,last_opened_at_unix_ms,access_mode) VALUES(?,?,?,?,?,?,?,?,?,?)`, forward.ForwardID, forward.TargetURL, forward.Name, forward.Description, forward.HealthPath, boolToInt(forward.InsecureSkipVerify), forward.CreatedAtUnixMs, forward.UpdatedAtUnixMs, forward.LastOpenedAtUnixMs, forward.AccessMode); err != nil {
		return err
	}
	if _, err = tx.Exec(`INSERT INTO managed_web_services(service_id,template_id,template_source,template_revision,template_snapshot_json,template_snapshot_sha256,service_family_id,deployment,workspace_path,configuration_json,version,desired_state,observed_state,forward_id,runtime_identity,runtime_manifest_json,runtime_port,artifact_reference,last_error_code,last_error_message,created_at_unix_ms,updated_at_unix_ms,configuration_revision,configuration_sha256) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, service.ServiceID, service.TemplateID, service.TemplateSource, service.TemplateRevision, service.TemplateSnapshotJSON, service.TemplateSnapshotSHA256, service.ServiceFamilyID, service.Deployment, service.WorkspacePath, service.ConfigurationJSON, service.Version, service.DesiredState, service.ObservedState, service.ForwardID, service.RuntimeIdentity, service.RuntimeManifestJSON, service.RuntimePort, service.ArtifactReference, service.LastErrorCode, service.LastErrorMessage, service.CreatedAtUnixMs, service.UpdatedAtUnixMs, service.ConfigurationRevision, service.ConfigurationSHA256); err != nil {
		return err
	}
	if operation != nil {
		if _, err = tx.Exec(`INSERT INTO managed_web_service_operations(operation_id,service_id,request_id,request_fingerprint,action,delete_data,state,stage,progress_current,progress_total,cancel_requested,error_code,error_message,created_at_unix_ms,updated_at_unix_ms,finished_at_unix_ms,progress_detail_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, operation.OperationID, operation.ServiceID, operation.RequestID, operation.RequestFingerprint, operation.Action, boolToInt(operation.DeleteData), operation.State, operation.Stage, operation.ProgressCurrent, operation.ProgressTotal, boolToInt(operation.CancelRequested), operation.ErrorCode, operation.ErrorMessage, operation.CreatedAtUnixMs, operation.UpdatedAtUnixMs, operation.FinishedAtUnixMs, operationProgressDetailJSON); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (r *Registry) UpdateManagedService(ctx context.Context, serviceID string, patch ManagedServicePatch) error {
	if r == nil || r.db == nil {
		return errors.New("registry not initialized")
	}
	sets, args := []string{}, []any{}
	add := func(column string, value any) { sets = append(sets, column+" = ?"); args = append(args, value) }
	if patch.TemplateRevision != nil {
		add("template_revision", *patch.TemplateRevision)
	}
	if patch.TemplateSnapshotJSON != nil {
		add("template_snapshot_json", strings.TrimSpace(*patch.TemplateSnapshotJSON))
	}
	if patch.TemplateSnapshotSHA256 != nil {
		add("template_snapshot_sha256", strings.TrimSpace(*patch.TemplateSnapshotSHA256))
	}
	if patch.ConfigurationJSON != nil {
		add("configuration_json", strings.TrimSpace(*patch.ConfigurationJSON))
	}
	if patch.ConfigurationRevision != nil {
		add("configuration_revision", *patch.ConfigurationRevision)
	}
	if patch.ConfigurationSHA256 != nil {
		add("configuration_sha256", strings.TrimSpace(*patch.ConfigurationSHA256))
	}
	if patch.Version != nil {
		add("version", strings.TrimSpace(*patch.Version))
	}
	if patch.DesiredState != nil {
		add("desired_state", strings.TrimSpace(*patch.DesiredState))
	}
	if patch.ObservedState != nil {
		add("observed_state", strings.TrimSpace(*patch.ObservedState))
	}
	if patch.RuntimeIdentity != nil {
		add("runtime_identity", strings.TrimSpace(*patch.RuntimeIdentity))
	}
	if patch.RuntimePort != nil {
		add("runtime_port", *patch.RuntimePort)
	}
	if patch.ArtifactReference != nil {
		add("artifact_reference", strings.TrimSpace(*patch.ArtifactReference))
	}
	if patch.RuntimeManifestJSON != nil {
		add("runtime_manifest_json", strings.TrimSpace(*patch.RuntimeManifestJSON))
	}
	if patch.LastErrorCode != nil {
		add("last_error_code", strings.TrimSpace(*patch.LastErrorCode))
	}
	if patch.LastErrorMessage != nil {
		add("last_error_message", strings.TrimSpace(*patch.LastErrorMessage))
	}
	if len(sets) == 0 {
		return errors.New("no fields to update")
	}
	add("updated_at_unix_ms", time.Now().UnixMilli())
	args = append(args, strings.TrimSpace(serviceID))
	result, err := r.db.ExecContext(nonNilContext(ctx), `UPDATE managed_web_services SET `+strings.Join(sets, ", ")+` WHERE service_id = ?`, args...)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return ErrManagedServiceNotFound
	}
	return nil
}

// UpdateManagedServiceConfiguration commits the instance configuration and
// its identity as one compare-and-swap operation. Callers must preflight the
// exact revision they read; stale drawers cannot overwrite a newer change.
func (r *Registry) UpdateManagedServiceConfiguration(ctx context.Context, serviceID string, expectedRevision int64, configurationJSON, configurationSHA256 string) (int64, error) {
	if r == nil || r.db == nil {
		return 0, errors.New("registry not initialized")
	}
	if expectedRevision <= 0 || len(strings.TrimSpace(configurationSHA256)) != 64 {
		return 0, errors.New("invalid managed service configuration identity")
	}
	nextRevision := expectedRevision + 1
	result, err := r.db.ExecContext(nonNilContext(ctx), `UPDATE managed_web_services SET configuration_json=?,configuration_revision=?,configuration_sha256=?,updated_at_unix_ms=? WHERE service_id=? AND configuration_revision=?`, strings.TrimSpace(configurationJSON), nextRevision, strings.TrimSpace(configurationSHA256), time.Now().UnixMilli(), strings.TrimSpace(serviceID), expectedRevision)
	if err != nil {
		return 0, err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return 0, err
	}
	if count != 1 {
		var exists int
		if err := r.db.QueryRowContext(nonNilContext(ctx), `SELECT COUNT(1) FROM managed_web_services WHERE service_id=?`, strings.TrimSpace(serviceID)).Scan(&exists); err != nil {
			return 0, err
		}
		if exists == 0 {
			return 0, ErrManagedServiceNotFound
		}
		return 0, errors.New("managed service configuration revision conflict")
	}
	return nextRevision, nil
}

func (r *Registry) CommitManagedServiceReconfiguration(ctx context.Context, serviceID string, expectedRevision int64, configurationJSON, configurationSHA256, runtimeIdentity, artifactReference, runtimeManifestJSON string) (int64, error) {
	if r == nil || r.db == nil {
		return 0, errors.New("registry not initialized")
	}
	if expectedRevision <= 0 || len(strings.TrimSpace(configurationSHA256)) != 64 {
		return 0, errors.New("invalid managed service configuration identity")
	}
	nextRevision := expectedRevision + 1
	blank := ""
	result, err := r.db.ExecContext(nonNilContext(ctx), `UPDATE managed_web_services SET configuration_json=?,configuration_revision=?,configuration_sha256=?,runtime_identity=?,artifact_reference=?,runtime_manifest_json=?,last_error_code=?,last_error_message=?,updated_at_unix_ms=? WHERE service_id=? AND configuration_revision=?`, strings.TrimSpace(configurationJSON), nextRevision, strings.TrimSpace(configurationSHA256), strings.TrimSpace(runtimeIdentity), strings.TrimSpace(artifactReference), strings.TrimSpace(runtimeManifestJSON), blank, blank, time.Now().UnixMilli(), strings.TrimSpace(serviceID), expectedRevision)
	if err != nil {
		return 0, err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return 0, err
	}
	if count != 1 {
		return 0, errors.New("managed service configuration revision conflict")
	}
	return nextRevision, nil
}

func (r *Registry) ListManagedServiceResources(ctx context.Context, serviceID string) ([]ManagedServiceResource, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("registry not initialized")
	}
	rows, err := r.db.QueryContext(nonNilContext(ctx), `SELECT service_id,resource_id,kind,engine_identity,created_at_unix_ms FROM managed_web_service_resources WHERE service_id=? ORDER BY resource_id`, strings.TrimSpace(serviceID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []ManagedServiceResource
	for rows.Next() {
		var value ManagedServiceResource
		if err := rows.Scan(&value.ServiceID, &value.ResourceID, &value.Kind, &value.EngineIdentity, &value.CreatedAtUnixMs); err != nil {
			return nil, err
		}
		result = append(result, value)
	}
	return result, rows.Err()
}

func (r *Registry) PutManagedServiceResource(ctx context.Context, value ManagedServiceResource) error {
	if r == nil || r.db == nil {
		return errors.New("registry not initialized")
	}
	if strings.TrimSpace(value.ServiceID) == "" || strings.TrimSpace(value.ResourceID) == "" || strings.TrimSpace(value.Kind) == "" || strings.TrimSpace(value.EngineIdentity) == "" || value.CreatedAtUnixMs <= 0 {
		return errors.New("invalid managed service resource identity")
	}
	_, err := r.db.ExecContext(nonNilContext(ctx), `INSERT INTO managed_web_service_resources(service_id,resource_id,kind,engine_identity,created_at_unix_ms) VALUES(?,?,?,?,?) ON CONFLICT(service_id,resource_id) DO UPDATE SET kind=excluded.kind,engine_identity=excluded.engine_identity,created_at_unix_ms=excluded.created_at_unix_ms`, value.ServiceID, value.ResourceID, value.Kind, value.EngineIdentity, value.CreatedAtUnixMs)
	return err
}

func (r *Registry) DeleteManagedServiceResource(ctx context.Context, serviceID, resourceID string) error {
	if r == nil || r.db == nil {
		return errors.New("registry not initialized")
	}
	_, err := r.db.ExecContext(nonNilContext(ctx), `DELETE FROM managed_web_service_resources WHERE service_id=? AND resource_id=?`, strings.TrimSpace(serviceID), strings.TrimSpace(resourceID))
	return err
}

func (r *Registry) DeleteManagedService(ctx context.Context, serviceID string) error {
	if r == nil || r.db == nil {
		return errors.New("registry not initialized")
	}
	tx, err := r.db.BeginTx(nonNilContext(ctx), nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var forwardID string
	if err := tx.QueryRow(`SELECT forward_id FROM managed_web_services WHERE service_id = ?`, strings.TrimSpace(serviceID)).Scan(&forwardID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrManagedServiceNotFound
		}
		return err
	}
	if _, err := tx.Exec(`DELETE FROM managed_web_services WHERE service_id = ?`, strings.TrimSpace(serviceID)); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM port_forwards WHERE forward_id = ?`, forwardID); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *Registry) CompleteManagedServiceUninstall(ctx context.Context, serviceID string, operation ManagedOperation) error {
	if r == nil || r.db == nil {
		return errors.New("registry not initialized")
	}
	tx, err := r.db.BeginTx(nonNilContext(ctx), nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var forwardID string
	if err := tx.QueryRow(`SELECT forward_id FROM managed_web_services WHERE service_id = ?`, strings.TrimSpace(serviceID)).Scan(&forwardID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrManagedServiceNotFound
		}
		return err
	}
	operation.UpdatedAtUnixMs = time.Now().UnixMilli()
	progressDetailJSON := emptyManagedOperationProgressDetailJSON
	if operation.ProgressDetail != nil {
		operation.ProgressDetail.UpdatedAtUnixMs = operation.UpdatedAtUnixMs
		detail, raw, detailErr := canonicalManagedOperationProgressDetail(*operation.ProgressDetail)
		if detailErr != nil {
			return detailErr
		}
		operation.ProgressDetail, progressDetailJSON = &detail, raw
	}
	result, err := tx.Exec(`UPDATE managed_web_service_operations SET state=?,stage=?,progress_current=?,progress_total=?,cancel_requested=?,error_code=?,error_message=?,updated_at_unix_ms=?,finished_at_unix_ms=?,progress_detail_json=? WHERE operation_id=? AND service_id=?`, operation.State, operation.Stage, operation.ProgressCurrent, operation.ProgressTotal, boolToInt(operation.CancelRequested), operation.ErrorCode, operation.ErrorMessage, operation.UpdatedAtUnixMs, operation.FinishedAtUnixMs, progressDetailJSON, operation.OperationID, strings.TrimSpace(serviceID))
	if err != nil {
		return err
	}
	if count, err := result.RowsAffected(); err != nil || count != 1 {
		if err != nil {
			return err
		}
		return errors.New("managed web service uninstall operation not found")
	}
	if _, err := tx.Exec(`DELETE FROM managed_web_services WHERE service_id = ?`, strings.TrimSpace(serviceID)); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM port_forwards WHERE forward_id = ?`, forwardID); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *Registry) CreateManagedOperation(ctx context.Context, operation ManagedOperation) error {
	if r == nil || r.db == nil {
		return errors.New("registry not initialized")
	}
	now := time.Now().UnixMilli()
	if operation.CreatedAtUnixMs <= 0 {
		operation.CreatedAtUnixMs = now
	}
	if operation.UpdatedAtUnixMs <= 0 {
		operation.UpdatedAtUnixMs = operation.CreatedAtUnixMs
	}
	progressDetailJSON := emptyManagedOperationProgressDetailJSON
	if operation.ProgressDetail != nil {
		detail, raw, detailErr := canonicalManagedOperationProgressDetail(*operation.ProgressDetail)
		if detailErr != nil {
			return detailErr
		}
		operation.ProgressDetail, progressDetailJSON = &detail, raw
	}
	_, err := r.db.ExecContext(nonNilContext(ctx), `INSERT INTO managed_web_service_operations(operation_id,service_id,request_id,request_fingerprint,action,delete_data,state,stage,progress_current,progress_total,cancel_requested,error_code,error_message,created_at_unix_ms,updated_at_unix_ms,finished_at_unix_ms,progress_detail_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, operation.OperationID, operation.ServiceID, operation.RequestID, operation.RequestFingerprint, operation.Action, boolToInt(operation.DeleteData), operation.State, operation.Stage, operation.ProgressCurrent, operation.ProgressTotal, boolToInt(operation.CancelRequested), operation.ErrorCode, operation.ErrorMessage, operation.CreatedAtUnixMs, operation.UpdatedAtUnixMs, operation.FinishedAtUnixMs, progressDetailJSON)
	return err
}

func (r *Registry) GetManagedOperation(ctx context.Context, operationID string) (*ManagedOperation, error) {
	return r.getManagedOperation(ctx, `operation_id`, operationID)
}
func (r *Registry) GetManagedOperationByRequestID(ctx context.Context, requestID string) (*ManagedOperation, error) {
	return r.getManagedOperation(ctx, `request_id`, requestID)
}

func (r *Registry) GetLatestManagedOperation(ctx context.Context, serviceID string) (*ManagedOperation, error) {
	return r.queryManagedOperation(ctx, `SELECT `+managedOperationSelectColumns+` FROM managed_web_service_operations WHERE service_id = ? ORDER BY created_at_unix_ms DESC, operation_id DESC LIMIT 1`, serviceID)
}

func (r *Registry) GetActiveManagedOperation(ctx context.Context, serviceID string) (*ManagedOperation, error) {
	return r.queryManagedOperation(ctx, `SELECT `+managedOperationSelectColumns+` FROM managed_web_service_operations WHERE service_id = ? AND state IN ('pending','running','cancelling') ORDER BY created_at_unix_ms DESC, operation_id DESC LIMIT 1`, serviceID)
}

func (r *Registry) GetLatestManagedOperationFailure(ctx context.Context, serviceID string) (*ManagedOperation, error) {
	return r.queryManagedOperation(ctx, `SELECT `+managedOperationSelectColumns+` FROM managed_web_service_operations WHERE service_id = ? AND error_code <> '' AND state IN ('failed','cancelled','interrupted') ORDER BY finished_at_unix_ms DESC, updated_at_unix_ms DESC, operation_id DESC LIMIT 1`, serviceID)
}

func (r *Registry) getManagedOperation(ctx context.Context, column, value string) (*ManagedOperation, error) {
	return r.queryManagedOperation(ctx, `SELECT `+managedOperationSelectColumns+` FROM managed_web_service_operations WHERE `+column+` = ?`, value)
}

func (r *Registry) queryManagedOperation(ctx context.Context, query, value string) (*ManagedOperation, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("registry not initialized")
	}
	op := ManagedOperation{}
	var cancel, deleteData int
	var progressDetailJSON sql.NullString
	err := r.db.QueryRowContext(nonNilContext(ctx), query, strings.TrimSpace(value)).Scan(&op.OperationID, &op.ServiceID, &op.RequestID, &op.RequestFingerprint, &op.Action, &deleteData, &op.State, &op.Stage, &op.ProgressCurrent, &op.ProgressTotal, &cancel, &op.ErrorCode, &op.ErrorMessage, &op.CreatedAtUnixMs, &op.UpdatedAtUnixMs, &op.FinishedAtUnixMs, &progressDetailJSON)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	op.CancelRequested = cancel != 0
	op.DeleteData = deleteData != 0
	if !progressDetailJSON.Valid {
		return nil, fmt.Errorf("managed Web Service operation %s progress detail is missing", op.OperationID)
	}
	detail, _, detailErr := decodeManagedOperationProgressDetail(progressDetailJSON.String)
	if detailErr != nil {
		return nil, fmt.Errorf("managed Web Service operation %s progress detail: %w", op.OperationID, detailErr)
	}
	op.ProgressDetail = &detail
	return &op, nil
}

func (r *Registry) HasActiveManagedOperation(ctx context.Context, serviceID string) (bool, error) {
	var count int
	err := r.db.QueryRowContext(nonNilContext(ctx), `SELECT COUNT(1) FROM managed_web_service_operations WHERE service_id = ? AND state IN ('pending','running','cancelling')`, strings.TrimSpace(serviceID)).Scan(&count)
	return count > 0, err
}

func (r *Registry) UpdateManagedOperation(ctx context.Context, op ManagedOperation) error {
	if r == nil || r.db == nil {
		return errors.New("registry not initialized")
	}
	op.UpdatedAtUnixMs = time.Now().UnixMilli()
	progressDetailJSON := emptyManagedOperationProgressDetailJSON
	if op.ProgressDetail != nil {
		op.ProgressDetail.UpdatedAtUnixMs = op.UpdatedAtUnixMs
		detail, raw, detailErr := canonicalManagedOperationProgressDetail(*op.ProgressDetail)
		if detailErr != nil {
			return detailErr
		}
		op.ProgressDetail, progressDetailJSON = &detail, raw
	}
	result, err := r.db.ExecContext(nonNilContext(ctx), `UPDATE managed_web_service_operations SET state=?,stage=?,progress_current=?,progress_total=?,cancel_requested=?,error_code=?,error_message=?,updated_at_unix_ms=?,finished_at_unix_ms=?,progress_detail_json=? WHERE operation_id=?`, op.State, op.Stage, op.ProgressCurrent, op.ProgressTotal, boolToInt(op.CancelRequested), op.ErrorCode, op.ErrorMessage, op.UpdatedAtUnixMs, op.FinishedAtUnixMs, progressDetailJSON, op.OperationID)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return errors.New("managed web service operation not found")
	}
	return nil
}

// FinalizeManagedOperation commits the terminal operation and its service state
// transition together. Failure diagnostics must never point at an operation
// state that was not committed, or vice versa.
func (r *Registry) FinalizeManagedOperation(ctx context.Context, op ManagedOperation, patch ManagedServicePatch) error {
	if r == nil || r.db == nil {
		return errors.New("registry not initialized")
	}
	if op.FinishedAtUnixMs <= 0 {
		return errors.New("managed web service operation is not terminal")
	}
	op.UpdatedAtUnixMs = time.Now().UnixMilli()
	progressDetailJSON := emptyManagedOperationProgressDetailJSON
	if op.ProgressDetail != nil {
		op.ProgressDetail.UpdatedAtUnixMs = op.UpdatedAtUnixMs
		detail, raw, detailErr := canonicalManagedOperationProgressDetail(*op.ProgressDetail)
		if detailErr != nil {
			return detailErr
		}
		op.ProgressDetail, progressDetailJSON = &detail, raw
	}
	tx, err := r.db.BeginTx(nonNilContext(ctx), nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	result, err := tx.Exec(`UPDATE managed_web_service_operations SET state=?,stage=?,progress_current=?,progress_total=?,cancel_requested=?,error_code=?,error_message=?,updated_at_unix_ms=?,finished_at_unix_ms=?,progress_detail_json=? WHERE operation_id=? AND service_id=?`, op.State, op.Stage, op.ProgressCurrent, op.ProgressTotal, boolToInt(op.CancelRequested), op.ErrorCode, op.ErrorMessage, op.UpdatedAtUnixMs, op.FinishedAtUnixMs, progressDetailJSON, strings.TrimSpace(op.OperationID), strings.TrimSpace(op.ServiceID))
	if err != nil {
		return err
	}
	if count, err := result.RowsAffected(); err != nil || count != 1 {
		if err != nil {
			return err
		}
		return errors.New("managed web service operation not found")
	}
	sets, args := []string{}, []any{}
	add := func(column string, value any) { sets = append(sets, column+" = ?"); args = append(args, value) }
	if patch.TemplateRevision != nil {
		add("template_revision", *patch.TemplateRevision)
	}
	if patch.TemplateSnapshotJSON != nil {
		add("template_snapshot_json", strings.TrimSpace(*patch.TemplateSnapshotJSON))
	}
	if patch.TemplateSnapshotSHA256 != nil {
		add("template_snapshot_sha256", strings.TrimSpace(*patch.TemplateSnapshotSHA256))
	}
	if patch.Version != nil {
		add("version", strings.TrimSpace(*patch.Version))
	}
	if patch.DesiredState != nil {
		add("desired_state", strings.TrimSpace(*patch.DesiredState))
	}
	if patch.ObservedState != nil {
		add("observed_state", strings.TrimSpace(*patch.ObservedState))
	}
	if patch.RuntimeIdentity != nil {
		add("runtime_identity", strings.TrimSpace(*patch.RuntimeIdentity))
	}
	if patch.RuntimeManifestJSON != nil {
		add("runtime_manifest_json", strings.TrimSpace(*patch.RuntimeManifestJSON))
	}
	if patch.LastErrorCode != nil {
		add("last_error_code", strings.TrimSpace(*patch.LastErrorCode))
	}
	if patch.LastErrorMessage != nil {
		add("last_error_message", strings.TrimSpace(*patch.LastErrorMessage))
	}
	if len(sets) > 0 {
		add("updated_at_unix_ms", op.UpdatedAtUnixMs)
		args = append(args, strings.TrimSpace(op.ServiceID))
		result, err = tx.Exec(`UPDATE managed_web_services SET `+strings.Join(sets, ", ")+` WHERE service_id = ?`, args...)
		if err != nil {
			return err
		}
		if count, err := result.RowsAffected(); err != nil || count != 1 {
			if err != nil {
				return err
			}
			return ErrManagedServiceNotFound
		}
	}
	return tx.Commit()
}

func (r *Registry) MarkManagedOperationsInterrupted(ctx context.Context) error {
	if r == nil || r.db == nil {
		return errors.New("registry not initialized")
	}
	now := time.Now().UnixMilli()
	tx, err := r.db.BeginTx(nonNilContext(ctx), nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	rows, err := tx.Query(`SELECT operation_id, service_id, progress_detail_json FROM managed_web_service_operations WHERE state IN ('pending','running','cancelling') ORDER BY operation_id`)
	if err != nil {
		return err
	}
	type interruptedDetail struct{ operationID, serviceID, raw string }
	var details []interruptedDetail
	for rows.Next() {
		var operationID, serviceID, raw string
		if err := rows.Scan(&operationID, &serviceID, &raw); err != nil {
			_ = rows.Close()
			return err
		}
		detail, _, detailErr := decodeManagedOperationProgressDetail(raw)
		if detailErr != nil {
			_ = rows.Close()
			return fmt.Errorf("managed Web Service operation %s progress detail: %w", operationID, detailErr)
		}
		detail.StageStartedAtUnixMs, detail.UpdatedAtUnixMs = now, now
		_, canonical, err := canonicalManagedOperationProgressDetail(detail)
		if err != nil {
			_ = rows.Close()
			return err
		}
		details = append(details, interruptedDetail{operationID: operationID, serviceID: serviceID, raw: canonical})
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, detail := range details {
		if _, err := tx.Exec(`UPDATE managed_web_service_operations SET state='interrupted',stage='interrupted',error_code='OPERATION_INTERRUPTED',error_message='The runtime stopped before this operation completed.',updated_at_unix_ms=?,finished_at_unix_ms=?,progress_detail_json=? WHERE operation_id=?`, now, now, detail.raw, detail.operationID); err != nil {
			return err
		}
		result, err := tx.Exec(`UPDATE managed_web_services SET desired_state='stopped',observed_state='error',last_error_code='OPERATION_INTERRUPTED',last_error_message='The runtime stopped before this operation completed.',updated_at_unix_ms=? WHERE service_id=?`, now, detail.serviceID)
		if err != nil {
			return err
		}
		if count, err := result.RowsAffected(); err != nil || count != 1 {
			if err != nil {
				return err
			}
			return fmt.Errorf("managed Web Service %s for interrupted operation %s was not found", detail.serviceID, detail.operationID)
		}
	}
	return tx.Commit()
}

func nonNilContext(ctx context.Context) context.Context {
	if ctx == nil {
		return context.Background()
	}
	return ctx
}
