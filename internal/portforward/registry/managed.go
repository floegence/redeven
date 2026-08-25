package registry

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

var (
	ErrManagedServiceNotFound = errors.New("managed web service not found")
	ErrManagedForward         = errors.New("managed port forward can only be removed by uninstalling its service")
)

type ManagedService struct {
	ServiceID         string `json:"service_id"`
	TemplateID        string `json:"template_id"`
	Deployment        string `json:"deployment"`
	WorkspacePath     string `json:"workspace_path"`
	Version           string `json:"version"`
	DesiredState      string `json:"desired_state"`
	ObservedState     string `json:"observed_state"`
	ForwardID         string `json:"forward_id"`
	RuntimeIdentity   string `json:"runtime_identity,omitempty"`
	RuntimePort       int    `json:"runtime_port,omitempty"`
	ArtifactReference string `json:"artifact_reference,omitempty"`
	LastErrorCode     string `json:"last_error_code,omitempty"`
	LastErrorMessage  string `json:"last_error_message,omitempty"`
	CreatedAtUnixMs   int64  `json:"created_at_unix_ms"`
	UpdatedAtUnixMs   int64  `json:"updated_at_unix_ms"`
}

type ManagedOperation struct {
	OperationID        string `json:"operation_id"`
	ServiceID          string `json:"service_id"`
	RequestID          string `json:"request_id"`
	RequestFingerprint string `json:"-"`
	Action             string `json:"action"`
	DeleteData         bool   `json:"delete_data,omitempty"`
	State              string `json:"state"`
	Stage              string `json:"stage"`
	ProgressCurrent    int64  `json:"progress_current"`
	ProgressTotal      int64  `json:"progress_total"`
	CancelRequested    bool   `json:"cancel_requested"`
	ErrorCode          string `json:"error_code,omitempty"`
	ErrorMessage       string `json:"error_message,omitempty"`
	CreatedAtUnixMs    int64  `json:"created_at_unix_ms"`
	UpdatedAtUnixMs    int64  `json:"updated_at_unix_ms"`
	FinishedAtUnixMs   int64  `json:"finished_at_unix_ms,omitempty"`
}

type ManagedServicePatch struct {
	DesiredState      *string
	ObservedState     *string
	RuntimeIdentity   *string
	RuntimePort       *int
	ArtifactReference *string
	LastErrorCode     *string
	LastErrorMessage  *string
}

func (r *Registry) ListManagedServices(ctx context.Context) ([]ManagedService, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("registry not initialized")
	}
	rows, err := r.db.QueryContext(nonNilContext(ctx), `SELECT service_id, template_id, deployment, workspace_path, version, desired_state, observed_state, forward_id, runtime_identity, runtime_port, artifact_reference, last_error_code, last_error_message, created_at_unix_ms, updated_at_unix_ms FROM managed_web_services ORDER BY created_at_unix_ms ASC`)
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
	err := scanManagedService(r.db.QueryRowContext(nonNilContext(ctx), `SELECT service_id, template_id, deployment, workspace_path, version, desired_state, observed_state, forward_id, runtime_identity, runtime_port, artifact_reference, last_error_code, last_error_message, created_at_unix_ms, updated_at_unix_ms FROM managed_web_services WHERE service_id = ?`, strings.TrimSpace(serviceID)), &value)
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
	return row.Scan(&value.ServiceID, &value.TemplateID, &value.Deployment, &value.WorkspacePath, &value.Version, &value.DesiredState, &value.ObservedState, &value.ForwardID, &value.RuntimeIdentity, &value.RuntimePort, &value.ArtifactReference, &value.LastErrorCode, &value.LastErrorMessage, &value.CreatedAtUnixMs, &value.UpdatedAtUnixMs)
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
	if forward.CreatedAtUnixMs <= 0 {
		forward.CreatedAtUnixMs = now
	}
	if forward.UpdatedAtUnixMs <= 0 {
		forward.UpdatedAtUnixMs = forward.CreatedAtUnixMs
	}
	if operation != nil {
		if operation.CreatedAtUnixMs <= 0 {
			operation.CreatedAtUnixMs = now
		}
		if operation.UpdatedAtUnixMs <= 0 {
			operation.UpdatedAtUnixMs = operation.CreatedAtUnixMs
		}
	}
	tx, err := r.db.BeginTx(nonNilContext(ctx), nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.Exec(`INSERT INTO port_forwards(forward_id,target_url,name,description,health_path,insecure_skip_verify,created_at_unix_ms,updated_at_unix_ms,last_opened_at_unix_ms) VALUES(?,?,?,?,?,?,?,?,?)`, forward.ForwardID, forward.TargetURL, forward.Name, forward.Description, forward.HealthPath, boolToInt(forward.InsecureSkipVerify), forward.CreatedAtUnixMs, forward.UpdatedAtUnixMs, forward.LastOpenedAtUnixMs); err != nil {
		return err
	}
	if _, err = tx.Exec(`INSERT INTO managed_web_services(service_id,template_id,deployment,workspace_path,version,desired_state,observed_state,forward_id,runtime_identity,runtime_port,artifact_reference,last_error_code,last_error_message,created_at_unix_ms,updated_at_unix_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, service.ServiceID, service.TemplateID, service.Deployment, service.WorkspacePath, service.Version, service.DesiredState, service.ObservedState, service.ForwardID, service.RuntimeIdentity, service.RuntimePort, service.ArtifactReference, service.LastErrorCode, service.LastErrorMessage, service.CreatedAtUnixMs, service.UpdatedAtUnixMs); err != nil {
		return err
	}
	if operation != nil {
		if _, err = tx.Exec(`INSERT INTO managed_web_service_operations(operation_id,service_id,request_id,request_fingerprint,action,delete_data,state,stage,progress_current,progress_total,cancel_requested,error_code,error_message,created_at_unix_ms,updated_at_unix_ms,finished_at_unix_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, operation.OperationID, operation.ServiceID, operation.RequestID, operation.RequestFingerprint, operation.Action, boolToInt(operation.DeleteData), operation.State, operation.Stage, operation.ProgressCurrent, operation.ProgressTotal, boolToInt(operation.CancelRequested), operation.ErrorCode, operation.ErrorMessage, operation.CreatedAtUnixMs, operation.UpdatedAtUnixMs, operation.FinishedAtUnixMs); err != nil {
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
	result, err := tx.Exec(`UPDATE managed_web_service_operations SET state=?,stage=?,progress_current=?,progress_total=?,cancel_requested=?,error_code=?,error_message=?,updated_at_unix_ms=?,finished_at_unix_ms=? WHERE operation_id=? AND service_id=?`, operation.State, operation.Stage, operation.ProgressCurrent, operation.ProgressTotal, boolToInt(operation.CancelRequested), operation.ErrorCode, operation.ErrorMessage, operation.UpdatedAtUnixMs, operation.FinishedAtUnixMs, operation.OperationID, strings.TrimSpace(serviceID))
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
	_, err := r.db.ExecContext(nonNilContext(ctx), `INSERT INTO managed_web_service_operations(operation_id,service_id,request_id,request_fingerprint,action,delete_data,state,stage,progress_current,progress_total,cancel_requested,error_code,error_message,created_at_unix_ms,updated_at_unix_ms,finished_at_unix_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, operation.OperationID, operation.ServiceID, operation.RequestID, operation.RequestFingerprint, operation.Action, boolToInt(operation.DeleteData), operation.State, operation.Stage, operation.ProgressCurrent, operation.ProgressTotal, boolToInt(operation.CancelRequested), operation.ErrorCode, operation.ErrorMessage, operation.CreatedAtUnixMs, operation.UpdatedAtUnixMs, operation.FinishedAtUnixMs)
	return err
}

func (r *Registry) GetManagedOperation(ctx context.Context, operationID string) (*ManagedOperation, error) {
	return r.getManagedOperation(ctx, `operation_id`, operationID)
}
func (r *Registry) GetManagedOperationByRequestID(ctx context.Context, requestID string) (*ManagedOperation, error) {
	return r.getManagedOperation(ctx, `request_id`, requestID)
}

func (r *Registry) GetLatestManagedOperation(ctx context.Context, serviceID string) (*ManagedOperation, error) {
	return r.queryManagedOperation(ctx, `SELECT operation_id,service_id,request_id,request_fingerprint,action,delete_data,state,stage,progress_current,progress_total,cancel_requested,error_code,error_message,created_at_unix_ms,updated_at_unix_ms,finished_at_unix_ms FROM managed_web_service_operations WHERE service_id = ? ORDER BY created_at_unix_ms DESC, operation_id DESC LIMIT 1`, serviceID)
}

func (r *Registry) GetActiveManagedOperation(ctx context.Context, serviceID string) (*ManagedOperation, error) {
	return r.queryManagedOperation(ctx, `SELECT operation_id,service_id,request_id,request_fingerprint,action,delete_data,state,stage,progress_current,progress_total,cancel_requested,error_code,error_message,created_at_unix_ms,updated_at_unix_ms,finished_at_unix_ms FROM managed_web_service_operations WHERE service_id = ? AND state IN ('pending','running','cancelling') ORDER BY created_at_unix_ms DESC, operation_id DESC LIMIT 1`, serviceID)
}

func (r *Registry) getManagedOperation(ctx context.Context, column, value string) (*ManagedOperation, error) {
	return r.queryManagedOperation(ctx, `SELECT operation_id,service_id,request_id,request_fingerprint,action,delete_data,state,stage,progress_current,progress_total,cancel_requested,error_code,error_message,created_at_unix_ms,updated_at_unix_ms,finished_at_unix_ms FROM managed_web_service_operations WHERE `+column+` = ?`, value)
}

func (r *Registry) queryManagedOperation(ctx context.Context, query, value string) (*ManagedOperation, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("registry not initialized")
	}
	op := ManagedOperation{}
	var cancel, deleteData int
	err := r.db.QueryRowContext(nonNilContext(ctx), query, strings.TrimSpace(value)).Scan(&op.OperationID, &op.ServiceID, &op.RequestID, &op.RequestFingerprint, &op.Action, &deleteData, &op.State, &op.Stage, &op.ProgressCurrent, &op.ProgressTotal, &cancel, &op.ErrorCode, &op.ErrorMessage, &op.CreatedAtUnixMs, &op.UpdatedAtUnixMs, &op.FinishedAtUnixMs)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	op.CancelRequested = cancel != 0
	op.DeleteData = deleteData != 0
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
	result, err := r.db.ExecContext(nonNilContext(ctx), `UPDATE managed_web_service_operations SET state=?,stage=?,progress_current=?,progress_total=?,cancel_requested=?,error_code=?,error_message=?,updated_at_unix_ms=?,finished_at_unix_ms=? WHERE operation_id=?`, op.State, op.Stage, op.ProgressCurrent, op.ProgressTotal, boolToInt(op.CancelRequested), op.ErrorCode, op.ErrorMessage, op.UpdatedAtUnixMs, op.FinishedAtUnixMs, op.OperationID)
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

func (r *Registry) MarkManagedOperationsInterrupted(ctx context.Context) error {
	now := time.Now().UnixMilli()
	_, err := r.db.ExecContext(nonNilContext(ctx), `UPDATE managed_web_service_operations SET state='interrupted',stage='interrupted',error_code='OPERATION_INTERRUPTED',error_message='The runtime stopped before this operation completed.',updated_at_unix_ms=?,finished_at_unix_ms=? WHERE state IN ('pending','running','cancelling')`, now, now)
	return err
}

func nonNilContext(ctx context.Context) context.Context {
	if ctx == nil {
		return context.Background()
	}
	return ctx
}
