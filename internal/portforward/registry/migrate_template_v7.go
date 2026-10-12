package registry

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	templatecontract "github.com/floegence/redeven-service-templates/template"
)

// The 5 -> 6 edge adapts only registry-owned execution documents. Source
// directories, applied identities, resources, configuration and history remain
// byte-for-byte unchanged in the same atomic startup transaction.
func migrateRegistryV5ToV6(tx *sql.Tx) error {
	if err := verifyRegistryVersion(tx, 5); err != nil {
		return err
	}
	rows, err := tx.Query(`SELECT template_id,spec_json FROM managed_web_service_templates ORDER BY template_id`)
	if err != nil {
		return err
	}
	type update struct{ id, raw, digest string }
	var updates []update
	for rows.Next() {
		var id, raw string
		if err := rows.Scan(&id, &raw); err != nil {
			_ = rows.Close()
			return err
		}
		spec, version, err := templatecontract.NormalizeSpec([]byte(raw))
		if err != nil || version != 6 {
			_ = rows.Close()
			return fmt.Errorf("template %s is not a supported v6 execution document", id)
		}
		next, err := json.Marshal(spec)
		if err != nil {
			_ = rows.Close()
			return err
		}
		sum := sha256.Sum256(next)
		updates = append(updates, update{id, string(next), hex.EncodeToString(sum[:])})
	}
	err = rows.Err()
	_ = rows.Close()
	if err != nil {
		return err
	}
	for _, u := range updates {
		if _, err := tx.Exec(`UPDATE managed_web_service_templates SET spec_json=?,spec_sha256=? WHERE template_id=?`, u.raw, u.digest, u.id); err != nil {
			return err
		}
	}
	return verifyRegistryVersion(tx, 6)
}
