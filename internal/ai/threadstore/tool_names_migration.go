package threadstore

import (
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/floegence/redeven/internal/ai/toolnames"
)

// Only product-owned execution configuration changes. Floret journals, effect
// identities and provider state remain opaque and byte-preserved.
func migrateThreadstoreV12ToV13(tx *sql.Tx) error {
	if err := verifyProductSchemaVersion(tx, 12); err != nil {
		return err
	}
	rows, err := tx.Query("SELECT request_key, execution_config_json FROM ai_flower_execution_authority")
	if err != nil {
		return err
	}
	type update struct{ key, old, next string }
	var updates []update
	for rows.Next() {
		var u update
		if err = rows.Scan(&u.key, &u.old); err != nil {
			rows.Close()
			return err
		}
		if u.old == "" {
			continue
		}
		u.next, err = migrateToolAllowlist(u.old)
		if err != nil {
			rows.Close()
			return err
		}
		if u.next != u.old {
			updates = append(updates, u)
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, u := range updates {
		result, err := tx.Exec("UPDATE ai_flower_execution_authority SET execution_config_json = ? WHERE request_key = ? AND execution_config_json = ?", u.next, u.key, u.old)
		if err != nil {
			return err
		}
		n, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if n != 1 {
			return errors.New("tool naming migration source changed")
		}
	}
	return verifyProductSchemaVersion(tx, 13)
}
func migrateToolAllowlist(raw string) (string, error) {
	var root map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &root); err != nil {
		return "", err
	}
	if root == nil {
		return "", errors.New("execution configuration must be an object")
	}
	optionsRaw, ok := root["Options"]
	if !ok {
		return raw, nil
	}
	var options map[string]json.RawMessage
	if err := json.Unmarshal(optionsRaw, &options); err != nil {
		return "", err
	}
	if options == nil {
		return raw, nil
	}
	listRaw, ok := options["tool_allowlist"]
	if !ok {
		return raw, nil
	}
	var names []string
	if err := json.Unmarshal(listRaw, &names); err != nil {
		return "", err
	}
	changed := false
	for i, n := range names {
		name := toolnames.MigrateAllowlistName(n)
		changed = changed || name != n
		names[i] = name
	}
	if !changed {
		return raw, nil
	}
	options["tool_allowlist"], _ = json.Marshal(names)
	root["Options"], _ = json.Marshal(options)
	out, err := json.Marshal(root)
	return string(out), err
}
