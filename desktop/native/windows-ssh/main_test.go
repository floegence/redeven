package main

import (
	"bytes"
	"testing"
)

func TestPasswordIsReturnedLiterally(t *testing.T) {
	var output bytes.Buffer
	password := " space $`&\"Unicode-密码 "
	if err := answer([]string{"user@host's password:"}, password, &output); err != nil {
		t.Fatal(err)
	}
	if output.String() != password+"\n" {
		t.Fatal("password bytes were changed")
	}
}

func TestHostKeyAndInvalidPromptsAreRejectedWithoutOutput(t *testing.T) {
	for _, prompt := range []string{"Are you sure you want to continue connecting (yes/no/[fingerprint])?", "", "Password expired"} {
		var output bytes.Buffer
		if err := answer([]string{prompt}, "secret", &output); err == nil || output.Len() != 0 {
			t.Fatal("non-password prompt received credentials")
		}
	}
}
