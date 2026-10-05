// Package tessivenspec embeds the authoritative, data-only Tessiven document schema.
package tessivenspec

import _ "embed"

//go:embed v1.schema.json
var Schema []byte
