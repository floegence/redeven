// Package tessivenspec embeds the authoritative, data-only Tessiven document schema.
package tessivenspec

import _ "embed"

const Namespace = "redeven.io/tessiven/"
const CurrentVersion = "v1.0.0"
const CurrentAPIVersion = Namespace + CurrentVersion

//go:embed v1.0.0.schema.json
var Schema []byte

// The legacy schema is frozen. Never extend an existing version in place.
//
//go:embed v1.schema.json
var legacySchema []byte

type Format struct {
	Version   string
	UpgradeTo string
	Schema    []byte
}

// Formats is the closed, ordered DSL lineage. Unknown versions are never
// interpreted through a nearby schema or automatically downgraded.
func Formats() []Format {
	return []Format{
		{Version: "v1", UpgradeTo: "v1.0.0", Schema: append([]byte(nil), legacySchema...)},
		{Version: CurrentVersion, Schema: append([]byte(nil), Schema...)},
	}
}
