package managedwebservice

import _ "embed"

const (
	nativePackageJSONSHA256 = "11b62f1071c2fe20da63fa4e56482f00d7b0c054af10819ad6e59db5f3819215"
	nativePackageLockSHA256 = "d5d9ef04cd10c93c3d4fc93287bc1af019c60506db8db331c7f5b45593978a15"
	nativeNPMConfigSHA256   = "0ae95b8bcfeabff68db0b404980dfcaccfc89a8657d3d80bcd381665ee07320a"
)

//go:embed assets/deepseek-harness-native/.npmrc
var nativeNPMConfig []byte

//go:embed assets/deepseek-harness-native/package.json
var nativePackageJSON []byte

//go:embed assets/deepseek-harness-native/package-lock.json
var nativePackageLock []byte
