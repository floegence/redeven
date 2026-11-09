// Package toolnames owns Flower callable spelling, not provider-owned tools or
// browser JavaScript methods. Historical names are used only by migration and
// read-only presentation; they never install dispatch aliases.
package toolnames

import (
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
)

//go:embed migration.json
var migrationJSON []byte
var historical = func() map[string]string {
	var m map[string]string
	if err := json.Unmarshal(migrationJSON, &m); err != nil {
		panic(err)
	}
	return m
}()
var pattern = regexp.MustCompile(`^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$`)

func Validate(name string) error {
	if len(name) > 64 || !pattern.MatchString(name) {
		return fmt.Errorf("invalid callable tool name %q: use lowercase snake_case, at most 64 characters", name)
	}
	return nil
}

// Historical returns the current presentation/configuration name for one exact
// released spelling. It never rewrites text, parameters, signatures or IDs.
func Historical(name string) string {
	if n, ok := historical[name]; ok {
		return n
	}
	return name
}
func IsFirstParty(name string) bool {
	switch name {
	case "web_fetch", "automation_read_definition", "automation_save_definition", "automation_read_context", "automation_contribute", "automation_submit_result":
		return true
	}
	for _, n := range historical {
		if n == name {
			return true
		}
	}
	return false
}

// MCP preserves the exact released capability identity while giving its callable
// a provider-portable spelling. It never aliases dispatch to a different server.
func MCP(releasedName string) string {
	digest := sha256.Sum256([]byte(releasedName))
	return "mcp_" + hex.EncodeToString(digest[:24])
}

var releasedMCPName = regexp.MustCompile(`^mcp_.+_[0-9a-f]{16}$`)

// MigrateAllowlistName is used only by the one-time product schema migration.
// The released MCP callable includes the server identity and tool fingerprint;
// current server configuration is neither needed nor allowed to substitute it.
func MigrateAllowlistName(name string) string {
	if releasedMCPName.MatchString(name) {
		return MCP(name)
	}
	return Historical(name)
}
