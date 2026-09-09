package registry

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"
)

// ArchiveManagedService revokes the route and commits its recovery record together.
// It intentionally needs no engine, process inspection, or template resolution.
func (r *Registry) ArchiveManagedService(ctx context.Context, service ManagedService, state string) error {
	if state != "detached" && state != "uninstalled" {
		return errors.New("invalid management archive state")
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	current := ManagedService{}
	if err := scanManagedService(tx.QueryRow(`SELECT `+managedServiceSelectColumns+` FROM managed_web_services WHERE service_id=?`, service.ServiceID), &current); err != nil {
		return err
	}
	if current.ManagementState != service.ManagementState || current.ConfigurationRevision != service.ConfigurationRevision || current.RuntimeIdentity != service.RuntimeIdentity {
		return ErrManagedServiceRuntimeChanged
	}
	raw := current.ArchivedForwardJSON
	if current.ForwardID != "" {
		forward := Forward{}
		if err := tx.QueryRow(`SELECT forward_id,target_url,name,description,health_path,insecure_skip_verify,created_at_unix_ms,updated_at_unix_ms,last_opened_at_unix_ms,access_mode,default_app_path FROM port_forwards WHERE forward_id=?`, current.ForwardID).Scan(&forward.ForwardID, &forward.TargetURL, &forward.Name, &forward.Description, &forward.HealthPath, &forward.InsecureSkipVerify, &forward.CreatedAtUnixMs, &forward.UpdatedAtUnixMs, &forward.LastOpenedAtUnixMs, &forward.AccessMode, &forward.DefaultAppPath); err != nil {
			return err
		}
		bytes, err := json.Marshal(forward)
		if err != nil {
			return err
		}
		raw = string(bytes)
	}
	desired := current.DesiredState
	if state == "uninstalled" {
		desired = "stopped"
	}
	if _, err := tx.Exec(`UPDATE managed_web_services SET management_state=?,forward_id=NULL,archived_forward_json=?,desired_state=?,updated_at_unix_ms=? WHERE service_id=?`, state, raw, desired, time.Now().UnixMilli(), service.ServiceID); err != nil {
		return err
	}
	if current.ForwardID != "" {
		if _, err := tx.Exec(`DELETE FROM port_forwards WHERE forward_id=?`, current.ForwardID); err != nil {
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	r.revokeForwardAccess(current.ForwardID)
	return nil
}

// ActivateManagedService binds a freshly authorized route only after the caller
// has verified the archived resource. The active-template constraint is atomic.
func (r *Registry) ActivateManagedService(ctx context.Context, service ManagedService, forward Forward) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var state, identity string
	var revision int64
	if err := tx.QueryRow(`SELECT management_state,runtime_identity,configuration_revision FROM managed_web_services WHERE service_id=?`, service.ServiceID).Scan(&state, &identity, &revision); err != nil {
		return err
	}
	if state != service.ManagementState || state == "active" || identity != service.RuntimeIdentity || revision != service.ConfigurationRevision {
		return ErrManagedServiceRuntimeChanged
	}
	_, err = tx.Exec(`INSERT INTO port_forwards(forward_id,target_url,name,description,health_path,insecure_skip_verify,created_at_unix_ms,updated_at_unix_ms,last_opened_at_unix_ms,access_mode,default_app_path) VALUES(?,?,?,?,?,?,?,?,?,?,?)`, forward.ForwardID, forward.TargetURL, forward.Name, forward.Description, forward.HealthPath, boolToInt(forward.InsecureSkipVerify), time.Now().UnixMilli(), time.Now().UnixMilli(), 0, forward.AccessMode, forward.DefaultAppPath)
	if err != nil {
		return err
	}
	result, err := tx.Exec(`UPDATE managed_web_services SET management_state='active',forward_id=?,archived_forward_json='{}',updated_at_unix_ms=? WHERE service_id=?`, forward.ForwardID, time.Now().UnixMilli(), service.ServiceID)
	if err != nil {
		return err
	}
	if n, err := result.RowsAffected(); err != nil || n != 1 {
		return sql.ErrNoRows
	}
	return tx.Commit()
}
