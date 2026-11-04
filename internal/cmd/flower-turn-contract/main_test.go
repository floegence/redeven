package main

import (
	"go/constant"
	"go/token"
	"go/types"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestTurnKindsFollowEveryExportedTypedConstant(t *testing.T) {
	pkg := types.NewPackage(runtimePackage, "runtime")
	named := types.NewNamed(types.NewTypeName(token.NoPos, pkg, "TurnKind", nil), types.Typ[types.String], nil)
	pkg.Scope().Insert(named.Obj())
	for name, value := range map[string]string{"TurnKindExisting": "existing", "TurnKindNew": "new_kind", "TurnKindAlias": "existing", "TurnKindOrdinary": ""} {
		pkg.Scope().Insert(types.NewConst(token.NoPos, pkg, name, named, constant.MakeString(value)))
	}
	pkg.Scope().Insert(types.NewConst(token.NoPos, pkg, "OtherKind", types.Typ[types.String], constant.MakeString("other")))
	got, err := turnKinds(pkg)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, []string{"existing", "new_kind"}) {
		t.Fatalf("kinds=%v", got)
	}
	before := string(render([]string{"existing"}))
	after := string(render(got))
	if before == after || !strings.Contains(after, "new_kind") {
		t.Fatal("an additive upstream kind did not invalidate the consumer contract")
	}
}

func TestPublishedTurnKindContract(t *testing.T) {
	if err := run(filepath.Join("..", "..", ".."), true); err != nil {
		t.Fatal(err)
	}
}
