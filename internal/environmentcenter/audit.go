package environmentcenter

import (
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
)

// Exact payload bindings belong only to live challenges and grants. Audit
// records retain a closed action category, never a credential-derived digest
// or arbitrary browser-supplied text.
func auditActionKind(action string) string {
	for _, kind := range []string{"password", "factor:replace", "recovery:rotate", "gateway:add", "route:add", "route:rotate", "source:remove", "bookmark:add"} {
		if action == kind || strings.HasPrefix(action, kind+":") {
			return kind
		}
	}
	return "sensitive_action"
}

func (c *Center) auditDocument(tx *sql.Tx) (map[string]json.RawMessage, []auditEvent, error) {
	var raw []byte
	if err := tx.QueryRow("SELECT sealed FROM center_state WHERE singleton=1").Scan(&raw); err != nil {
		return nil, nil, err
	}
	if len(raw) < c.aead.NonceSize() {
		return nil, nil, errors.New("Center authentication state is damaged")
	}
	plain, err := c.aead.Open(nil, raw[:c.aead.NonceSize()], raw[c.aead.NonceSize():], c.aad())
	if err != nil {
		return nil, nil, errors.New("Center authentication key does not match state")
	}
	var document map[string]json.RawMessage
	var state storedState
	if json.Unmarshal(plain, &document) != nil || json.Unmarshal(plain, &state) != nil || state.Revision < 1 || state.DirectoryRevision < 1 || state.Failures == nil {
		return nil, nil, errors.New("Center state authority is incomplete")
	}
	return document, state.Audit, nil
}

func (c *Center) migratePrivateAudit(tx *sql.Tx) error {
	document, audit, err := c.auditDocument(tx)
	if err != nil {
		return err
	}
	changed := false
	for i := range audit {
		if audit[i].Action == "sensitive_authentication" {
			kind := auditActionKind(audit[i].Reference)
			changed = changed || kind != audit[i].Reference
			audit[i].Reference = kind
		}
	}
	if !changed {
		return nil
	}
	document["Audit"], err = json.Marshal(audit)
	if err != nil {
		return err
	}
	plain, err := json.Marshal(document)
	if err != nil {
		return err
	}
	nonce := make([]byte, c.aead.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return err
	}
	sealed := c.aead.Seal(nonce, nonce, plain, c.aad())
	_, err = tx.Exec("UPDATE center_state SET generation=generation+1,sealed=? WHERE singleton=1", sealed)
	return err
}

func (c *Center) verifyPrivateAudit(tx *sql.Tx) error {
	_, audit, err := c.auditDocument(tx)
	if err != nil {
		return err
	}
	for _, event := range audit {
		if event.Action == "sensitive_authentication" && event.Reference != auditActionKind(event.Reference) {
			return errors.New("Center audit contains a sensitive action payload")
		}
	}
	return nil
}
