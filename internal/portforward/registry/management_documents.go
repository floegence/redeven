package registry

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

func verifyManagementDocuments(tx *sql.Tx) error {
	rows, err := tx.Query(`SELECT service_id,management_state,archived_forward_json,runtime_identity,runtime_manifest_json FROM managed_web_services`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id, state, archive, identity, manifest string
		if err := rows.Scan(&id, &state, &archive, &identity, &manifest); err != nil {
			return err
		}
		if state != "active" {
			var forward Forward
			if err := decodeStrictRegistryJSON(archive, &forward); err != nil || forward.TargetURL == "" {
				return fmt.Errorf("invalid archived service route: %s", id)
			}
		}
		if strings.TrimSpace(manifest) == "" {
			continue
		}
		var header struct {
			Kind string `json:"kind"`
		}
		if err := json.Unmarshal([]byte(manifest), &header); err != nil {
			return fmt.Errorf("invalid lifecycle transaction: %s", id)
		}
		if header.Kind != "redeven.managed_service_uninstall.v1" {
			continue
		}
		var journal struct {
			Kind            string `json:"kind"`
			OperationID     string `json:"operation_id"`
			PlanDigest      string `json:"plan_digest"`
			RuntimeIdentity string `json:"runtime_identity"`
			RuntimeState    string `json:"runtime_state"`
			Resources       []struct {
				Resource json.RawMessage `json:"resource"`
				State    string          `json:"state"`
			} `json:"resources"`
			Irreversible bool `json:"irreversible"`
		}
		if err := decodeStrictRegistryJSON(manifest, &journal); err != nil {
			return err
		}
		if journal.OperationID == "" || len(journal.PlanDigest) != 64 || journal.RuntimeIdentity != identity {
			return errors.New("uninstall transaction identity is invalid")
		}
		if journal.RuntimeState != "pending" && journal.RuntimeState != "executing" && journal.RuntimeState != "completed" {
			return errors.New("uninstall runtime result is invalid")
		}
		ids := map[string]bool{}
		for _, item := range journal.Resources {
			switch item.State {
			case "pending", "executing", "completed", "blocked", "retained":
			default:
				return errors.New("uninstall resource result is invalid")
			}
			var resource map[string]json.RawMessage
			if err := json.Unmarshal(item.Resource, &resource); err != nil {
				return err
			}
			for name := range resource {
				switch name {
				case "resource_id", "kind", "identity", "generation", "stable_identity", "presence", "ownership", "problem_code", "references":
				default:
					return errors.New("uninstall resource contains an unknown field")
				}
			}
			var resourceID, kind, target string
			if json.Unmarshal(resource["resource_id"], &resourceID) != nil || json.Unmarshal(resource["kind"], &kind) != nil || json.Unmarshal(resource["identity"], &target) != nil || resourceID == "" || target == "" || ids[resourceID] {
				return errors.New("uninstall resource identity is invalid")
			}
			ids[resourceID] = true
			if kind != "volume" && kind != "directory" && kind != "network" {
				return errors.New("uninstall resource kind is invalid")
			}
		}
	}
	return rows.Err()
}
