package environmentcenter

import (
	"github.com/pquerna/otp/totp"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func TestSetupLostResponsesRetainOneBrowserBoundOperation(t *testing.T) {
	c, err := Open(filepath.Join(t.TempDir(), "center"), "https://center.example.test")
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	now := time.Unix(1800000000, 0)
	c.now = func() time.Time { return now }
	token, err := c.OwnerBootstrap(false)
	if err != nil {
		t.Fatal(err)
	}
	first, err := c.SetupStart(token, "browser", testPassword)
	if err != nil {
		t.Fatal(err)
	}
	retry, err := c.SetupStart(token, "browser", testPassword)
	if err != nil || !reflect.DeepEqual(first, retry) || len(c.setups) != 1 {
		t.Fatal("lost start response created another authenticator")
	}
	if _, err := c.SetupStart(token, "another", testPassword); err == nil {
		t.Fatal("bootstrap crossed browser claim")
	}
	if _, err := c.SetupStart(token, "browser", testPassword+" changed"); err == nil {
		t.Fatal("start retry replaced password")
	}
	code, _ := totp.GenerateCode(first.Secret, now)
	verified, err := c.SetupVerify(first.Operation, "browser", "", code)
	if err != nil {
		t.Fatal(err)
	}
	repeated, err := c.SetupVerify(first.Operation, "browser", "", code)
	if err != nil || !reflect.DeepEqual(verified, repeated) {
		t.Fatal("verify retry changed recovery batch")
	}
	if _, err := c.SetupVerify(first.Operation, "browser", "", "invalid"); err == nil {
		t.Fatal("verified operation accepted changed factor")
	}
	if err := c.SetupCommit(first.Operation, "browser", "", true); err != nil {
		t.Fatal(err)
	}
	revision := c.state.Revision
	if err := c.SetupCommit(first.Operation, "browser", "", true); err != nil || c.state.Revision != revision {
		t.Fatal("lost commit response did not recover one result")
	}
	if err := c.SetupCommit(first.Operation, "another", "", true); err == nil {
		t.Fatal("commit receipt crossed browser")
	}
	if _, err := c.OwnerBootstrap(true); err != nil {
		t.Fatal(err)
	}
	if err := c.SetupCommit(first.Operation, "browser", "", true); err == nil {
		t.Fatal("old receipt crossed credential revision")
	}
}
