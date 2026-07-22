// Command read_redevplugin_package_set prints the package-set contract embedded
// in the released ReDevPlugin Go module consumed by Redeven.
package main

import (
	"encoding/json"
	"os"

	"github.com/floegence/redevplugin/pkg/contracts"
)

func main() {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(contracts.PackageSet()); err != nil {
		panic(err)
	}
}
