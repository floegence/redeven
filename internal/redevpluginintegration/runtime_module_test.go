package redevpluginintegration

import (
	"testing"

	"github.com/floegence/redevplugin/pkg/runtimetarget"
)

func TestOfficialRuntimeHashesCoverClosedTargetSet(t *testing.T) {
	want := map[runtimetarget.Target]string{
		runtimetarget.DarwinARM64: "fea17883ff27e943eeebc8bf9a68bd3d8c535b95d278fb18da0c3ec3d165dcca",
		runtimetarget.DarwinAMD64: "eca4f841c60a3e2cb4e76c51567ed7d1cab60a16396db6cbdbaf3d1cc9559841",
		runtimetarget.LinuxARM64:  "95cd87a998d8ae5c6ea3451551e72c69b8f5e27040b1016fcd39333e2b251b45",
		runtimetarget.LinuxAMD64:  "4f9ccbe61463fa7dc0053086dca128743b493b74f5b4535994d6dbccde55aef4",
	}
	if len(want) != len(runtimetarget.Supported()) {
		t.Fatalf("runtime hash matrix has %d targets, platform has %d", len(want), len(runtimetarget.Supported()))
	}
	for _, target := range runtimetarget.Supported() {
		if got := officialRuntimeSHA256(target); got != want[target] {
			t.Fatalf("runtime sha256 for %s = %s", target, got)
		}
	}
	if got := officialRuntimeSHA256(0); got != "" {
		t.Fatalf("invalid target runtime sha256 = %q", got)
	}
}
